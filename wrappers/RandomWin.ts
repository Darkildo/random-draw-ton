import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Dictionary,
    DictionaryValue,
    Sender,
    SendMode,
} from '@ton/core';

export type Draw = {
    minEntryAmount: bigint;
    entryAmountLimit: bigint;
    poolSum: bigint;
    participantCounter: number;
    participants: Dictionary<Address, bigint>;
};

export type RandomWinConfig = {
    owner: Address;
    fee: number; // percent: [0..100]
    drawMap: Dictionary<number, Draw>;
};

export type RandomWinStorage = {
    owner: Address;
    fee: number;
    drawMap: Dictionary<number, Draw>;
};

const CoinsValue: DictionaryValue<bigint> = {
    serialize: (src, builder) => {
        builder.storeCoins(src);
    },
    parse: (src) => {
        const value = src.loadCoins();
        src.endParse();
        return value;
    },
};

const DrawValue: DictionaryValue<Draw> = {
    serialize: (src, builder) => {
        builder.storeCoins(src.minEntryAmount);
        builder.storeCoins(src.entryAmountLimit);
        builder.storeCoins(src.poolSum);
        builder.storeUint(src.participantCounter, 32);
        builder.storeDict(src.participants, Dictionary.Keys.Address(), CoinsValue);
    },
    parse: (src) => {
        const minEntryAmount = src.loadCoins();
        const entryAmountLimit = src.loadCoins();
        const poolSum = src.loadCoins();
        const participantCounter = src.loadUint(32);
        const participants = Dictionary.load(Dictionary.Keys.Address(), CoinsValue, src);
        src.endParse();
        return { minEntryAmount, entryAmountLimit, poolSum, participantCounter, participants };
    },
};

export function randomWinConfigToCell(config: RandomWinConfig): Cell {
    return beginCell()
        .storeAddress(config.owner)
        .storeUint(config.fee, 16)
        .storeDict(config.drawMap, Dictionary.Keys.Uint(32), DrawValue)
        .endCell();
}

export function randomWinStorageFromCell(data: Cell): RandomWinStorage {
    const slice = data.beginParse();
    const owner = slice.loadAddress();
    const fee = Number(slice.loadUint(16));
    const drawMap = Dictionary.load(Dictionary.Keys.Uint(32), DrawValue, slice);
    slice.endParse();
    return { owner, fee, drawMap };
}

export const Opcodes = {
    OP_LUCK_ROLL: 0x0f1a3ea5,
    OP_CREATE_DRAW: 0x7e8764ef,
    TOP_UP: 0xd372158c,
};

export class RandomWin implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) { }

    static createFromAddress(address: Address) {
        return new RandomWin(address);
    }

    static createFromConfig(config: RandomWinConfig, code: Cell, workchain = 0) {
        const data = randomWinConfigToCell(config);
        const init = { code, data };
        return new RandomWin(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendCreateDraw(
        provider: ContractProvider,
        via: Sender,
        opts: {
            queryId: bigint;
            drawId: number;
            minEntryAmount: bigint;
            entryLimit: bigint;
            value: bigint;
        }
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.OP_CREATE_DRAW, 32)
                .storeUint(opts.queryId, 64)
                .storeUint(opts.drawId, 32)
                .storeCoins(opts.minEntryAmount)
                .storeCoins(opts.entryLimit)
                .endCell(),
        });
    }

    async sendLuckRoll(
        provider: ContractProvider,
        via: Sender,
        opts: {
            queryId: bigint;
            drawId: number;
            value: bigint;
        }
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.OP_LUCK_ROLL, 32)
                .storeUint(opts.queryId, 64)
                .storeUint(opts.drawId, 32)
                .endCell(),
        });
    }

    async sendTopUp(
        provider: ContractProvider,
        via: Sender,
        opts: {
            value: bigint;
        }
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.TOP_UP, 32)
                .endCell(),
        });
    }

    async getOwner(provider: ContractProvider): Promise<Address> {
        const result = await provider.get('get_owner', []);
        return result.stack.readAddress();
    }

    async getStorage(provider: ContractProvider): Promise<RandomWinStorage> {
        const state = await provider.getState();
        if (state.state.type !== 'active' || !state.state.data) {
            throw new Error('Contract is not active');
        }
        const dataCell = Cell.fromBoc(state.state.data)[0];
        return randomWinStorageFromCell(dataCell);
    }

    async getDraw(provider: ContractProvider, drawId: number): Promise<Draw | null> {
        const storage = await this.getStorage(provider);
        return storage.drawMap.get(drawId) ?? null;
    }
}
