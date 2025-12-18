import { Blockchain, SandboxContract, TreasuryContract, SendMessageResult } from '@ton/sandbox';
import { Cell, Dictionary, beginCell, toNano } from '@ton/core';
import { RandomWin } from '../wrappers/RandomWin';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';

describe('RandomWin (random_win.tolk)', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('RandomWin');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let randomWin: SandboxContract<RandomWin>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');

        randomWin = blockchain.openContract(
            RandomWin.createFromConfig(
                {
                    owner: deployer.address,
                    fee: 1,
                    drawMap: Dictionary.empty(),
                },
                code
            )
        );

        const deployResult = await randomWin.sendDeploy(deployer.getSender(), toNano('0.5'));
        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: randomWin.address,
            deploy: true,
            success: true,
        });
    });

    it('returns owner and empty storage after deploy', async () => {
        const owner = await randomWin.getOwner();
        expect(owner.equals(deployer.address)).toBe(true);

        const storage = await randomWin.getStorage();
        expect(storage.owner.equals(deployer.address)).toBe(true);
        expect(storage.fee).toBe(1);
        expect(storage.drawMap.size).toBe(0);
    });

    describe('CreateDraw', () => {
        it('creates a draw and stores base params', async () => {
            const drawId = 1;
            const minEntryAmount = toNano('1');
            const entryLimit = toNano('10');
            const createValue = toNano('0.5');

            const result = await randomWin.sendCreateDraw(deployer.getSender(), {
                queryId: 1n,
                drawId,
                minEntryAmount,
                entryLimit,
                value: createValue,
            });

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: randomWin.address,
                success: true,
            });

            const draw = await randomWin.getDraw(drawId);
            expect(draw).not.toBeNull();
            expect(draw!.minEntryAmount).toBe(minEntryAmount);
            expect(draw!.entryAmountLimit).toBe(entryLimit);
            expect(draw!.poolSum).toBe(createValue);
            expect(draw!.participantCounter).toBe(0);
            expect(draw!.participants.size).toBe(0);
        });

        it('rejects CreateDraw with zero value (cannot pay fees)', async () => {
            const drawId = 2;
            const minEntryAmount = toNano('1');
            const entryLimit = toNano('10');

            const result = await randomWin.sendCreateDraw(deployer.getSender(), {
                queryId: 1n,
                drawId,
                minEntryAmount,
                entryLimit,
                value: 0n,
            });

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: randomWin.address,
                success: false,
                aborted: true,
            });

            const draw = await randomWin.getDraw(drawId);
            expect(draw).toBeNull();
        });

        it('fails when draw already exists', async () => {
            const drawId = 1;
            const minEntryAmount = toNano('1');
            const entryLimit = toNano('10');

            await randomWin.sendCreateDraw(deployer.getSender(), {
                queryId: 1n,
                drawId,
                minEntryAmount,
                entryLimit,
                value: toNano('0.1'),
            });

            const result = await randomWin.sendCreateDraw(deployer.getSender(), {
                queryId: 2n,
                drawId,
                minEntryAmount,
                entryLimit,
                value: toNano('0.1'),
            });

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: randomWin.address,
                success: false,
                exitCode: 1004, // ERROR_DRAW_ALREADY_EXISTS
            });
        });
    });

    describe('LuckRoll', () => {
        it('fails when draw not found', async () => {
            const roller = await blockchain.treasury('roller');

            const result = await randomWin.sendLuckRoll(roller.getSender(), {
                queryId: 1n,
                drawId: 999,
                value: toNano('1'),
            });

            expect(result.transactions).toHaveTransaction({
                from: roller.address,
                to: randomWin.address,
                success: false,
                exitCode: 1009, // ERROR_DRAW_NOT_FOUND
            });
        });

        it('refunds when value < minEntryAmount', async () => {
            const drawId = 1;
            await randomWin.sendCreateDraw(deployer.getSender(), {
                queryId: 1n,
                drawId,
                minEntryAmount: toNano('1'),
                entryLimit: toNano('10'),
                value: toNano('0.1'),
            });

            const roller = await blockchain.treasury('roller');
            const sent = toNano('0.5');
            const result = await randomWin.sendLuckRoll(roller.getSender(), {
                queryId: 2n,
                drawId,
                value: sent,
            });

            expect(result.transactions).toHaveTransaction({
                from: roller.address,
                to: randomWin.address,
                success: true,
            });

            expect(result.transactions).toHaveTransaction({
                from: randomWin.address,
                to: roller.address,
                success: true,
                value: (v) => v !== undefined && v > 0n && v < sent,
            });

            const drawAfter = await randomWin.getDraw(drawId);
            expect(drawAfter).not.toBeNull();
            expect(drawAfter!.poolSum).toBe(toNano('0.1'));
            expect(drawAfter!.participants.size).toBe(0);
            expect(drawAfter!.participantCounter).toBe(0);
        });

        it('accepts value equal to minEntryAmount', async () => {
            const drawId = 1;
            const createValue = toNano('0.1');
            const minEntryAmount = toNano('1');

            await randomWin.sendCreateDraw(deployer.getSender(), {
                queryId: 1n,
                drawId,
                minEntryAmount,
                entryLimit: toNano('100'),
                value: createValue,
            });

            const roller = await blockchain.treasury('roller');
            const rollValue = minEntryAmount;
            const result = await randomWin.sendLuckRoll(roller.getSender(), {
                queryId: 2n,
                drawId,
                value: rollValue,
            });

            expect(result.transactions).toHaveTransaction({
                from: roller.address,
                to: randomWin.address,
                success: true,
            });

            const draw = await randomWin.getDraw(drawId);
            expect(draw).not.toBeNull();
            expect(draw!.participants.get(roller.address)).toBe(rollValue);
            expect(draw!.participantCounter).toBe(1);
            expect(draw!.poolSum).toBe(createValue + rollValue);
        });

        it('adds participant and increases poolSum', async () => {
            const drawId = 1;
            const createValue = toNano('0.5');
            await randomWin.sendCreateDraw(deployer.getSender(), {
                queryId: 1n,
                drawId,
                minEntryAmount: toNano('1'),
                entryLimit: toNano('100'),
                value: createValue,
            });

            const roller = await blockchain.treasury('roller');
            const rollValue = toNano('2');
            const result = await randomWin.sendLuckRoll(roller.getSender(), {
                queryId: 2n,
                drawId,
                value: rollValue,
            });

            expect(result.transactions).toHaveTransaction({
                from: roller.address,
                to: randomWin.address,
                success: true,
            });

            const draw = await randomWin.getDraw(drawId);
            expect(draw).not.toBeNull();
            expect(draw!.poolSum).toBe(createValue + rollValue);
            expect(draw!.participantCounter).toBe(1);
            expect(draw!.participants.get(roller.address)).toBe(rollValue);
        });

        it('counts only unique participants in participantCounter', async () => {
            const drawId = 1;
            const createValue = toNano('0.1');
            await randomWin.sendCreateDraw(deployer.getSender(), {
                queryId: 1n,
                drawId,
                minEntryAmount: toNano('1'),
                entryLimit: toNano('100'),
                value: createValue,
            });

            const roller1 = await blockchain.treasury('roller1');
            const roller2 = await blockchain.treasury('roller2');

            await randomWin.sendLuckRoll(roller1.getSender(), { queryId: 2n, drawId, value: toNano('2') });
            await randomWin.sendLuckRoll(roller2.getSender(), { queryId: 3n, drawId, value: toNano('2') });
            await randomWin.sendLuckRoll(roller1.getSender(), { queryId: 4n, drawId, value: toNano('1') });

            const draw = await randomWin.getDraw(drawId);
            expect(draw).not.toBeNull();
            expect(draw!.participantCounter).toBe(2);
            expect(draw!.participants.get(roller1.address)).toBe(toNano('3'));
            expect(draw!.participants.get(roller2.address)).toBe(toNano('2'));
            expect(draw!.poolSum).toBe(createValue + toNano('2') + toNano('2') + toNano('1'));
        });

        it('accumulates multiple rolls from the same participant', async () => {
            const drawId = 1;
            await randomWin.sendCreateDraw(deployer.getSender(), {
                queryId: 1n,
                drawId,
                minEntryAmount: toNano('1'),
                entryLimit: toNano('100'),
                value: toNano('0.1'),
            });

            const roller = await blockchain.treasury('roller');

            await randomWin.sendLuckRoll(roller.getSender(), {
                queryId: 2n,
                drawId,
                value: toNano('2'),
            });
            await randomWin.sendLuckRoll(roller.getSender(), {
                queryId: 3n,
                drawId,
                value: toNano('3'),
            });

            const draw = await randomWin.getDraw(drawId);
            expect(draw).not.toBeNull();
            expect(draw!.participantCounter).toBe(1);
            expect(draw!.participants.get(roller.address)).toBe(toNano('5'));
        });

        it('with a single participant: always pays that participant and deletes draw', async () => {
            const drawId = 1;
            const createValue = toNano('0.1');
            const entryLimit = toNano('3');

            await randomWin.sendCreateDraw(deployer.getSender(), {
                queryId: 1n,
                drawId,
                minEntryAmount: toNano('1'),
                entryLimit,
                value: createValue,
            });

            const roller = await blockchain.treasury('roller');

            await randomWin.sendLuckRoll(roller.getSender(), {
                queryId: 2n,
                drawId,
                value: toNano('1'),
            });

            const drawMid = await randomWin.getDraw(drawId);
            expect(drawMid).not.toBeNull();
            expect(drawMid!.participantCounter).toBe(1);

            const result = await randomWin.sendLuckRoll(roller.getSender(), {
                queryId: 3n,
                drawId,
                value: toNano('2'),
            });

            const poolSum = createValue + toNano('1') + toNano('2');
            expect(poolSum).toBeGreaterThanOrEqual(entryLimit);
            const expectedPayout = (poolSum * 99n) / 100n;

            expect(result.transactions).toHaveTransaction({
                from: randomWin.address,
                to: roller.address,
                success: true,
                value: (v) => v !== undefined && v > 0n && v <= expectedPayout,
            });

            const drawAfter = await randomWin.getDraw(drawId);
            expect(drawAfter).toBeNull();

            const resultAfter = await randomWin.sendLuckRoll(roller.getSender(), {
                queryId: 4n,
                drawId,
                value: toNano('1'),
            });
            expect(resultAfter.transactions).toHaveTransaction({
                from: roller.address,
                to: randomWin.address,
                success: false,
                exitCode: 1009, // ERROR_DRAW_NOT_FOUND
            });
        });

        it('when poolSum reaches limit: sends payout to last roller and deletes draw', async () => {
            const drawId = 1;
            const feePercent = 1n;
            const minEntryAmount = toNano('1');
            const entryLimit = toNano('10');

            const createValue = toNano('0.5');
            await randomWin.sendCreateDraw(deployer.getSender(), {
                queryId: 1n,
                drawId,
                minEntryAmount,
                entryLimit,
                value: createValue,
            });

            const roller1 = await blockchain.treasury('roller1');
            const roller2 = await blockchain.treasury('roller2');

            const roll1 = toNano('3');
            await randomWin.sendLuckRoll(roller1.getSender(), {
                queryId: 2n,
                drawId,
                value: roll1,
            });

            const roll2 = toNano('6.5'); // makes poolSum == 10 TON
            const result = await randomWin.sendLuckRoll(roller2.getSender(), {
                queryId: 3n,
                drawId,
                value: roll2,
            });

            const poolSum = createValue + roll1 + roll2;
            expect(poolSum).toBe(entryLimit);

            const expectedPayout = (poolSum * (100n - feePercent)) / 100n;

            expect(result.transactions).toHaveTransaction({
                from: roller2.address,
                to: randomWin.address,
                success: true,
            });

            expect(result.transactions).toHaveTransaction({
                from: randomWin.address,
                to: (addr) =>
                    addr !== undefined &&
                    (addr.equals(roller1.address) || addr.equals(roller2.address)),
                success: true,
                value: (v) => v !== undefined && v > 0n && v <= expectedPayout,
            });

            const drawAfter = await randomWin.getDraw(drawId);
            expect(drawAfter).toBeNull();

            const resultAfter = await randomWin.sendLuckRoll(roller1.getSender(), {
                queryId: 4n,
                drawId,
                value: toNano('1'),
            });
            expect(resultAfter.transactions).toHaveTransaction({
                from: roller1.address,
                to: randomWin.address,
                success: false,
                exitCode: 1009, // ERROR_DRAW_NOT_FOUND
            });
        });
    });

    describe('TopUpTons', () => {
        it('does not change draws', async () => {
            const drawId = 1;
            await randomWin.sendCreateDraw(deployer.getSender(), {
                queryId: 1n,
                drawId,
                minEntryAmount: toNano('1'),
                entryLimit: toNano('10'),
                value: toNano('0.1'),
            });

            const before = await randomWin.getDraw(drawId);
            expect(before).not.toBeNull();

            const result = await randomWin.sendTopUp(deployer.getSender(), { value: toNano('1') });
            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: randomWin.address,
                success: true,
            });

            const after = await randomWin.getDraw(drawId);
            expect(after).not.toBeNull();
            expect(after!.minEntryAmount).toBe(before!.minEntryAmount);
            expect(after!.entryAmountLimit).toBe(before!.entryAmountLimit);
            expect(after!.poolSum).toBe(before!.poolSum);
            expect(after!.participants.size).toBe(before!.participants.size);
        });
    });

    describe('Many participants', () => {
        const participantCounts = [10, 50, 100];

        participantCounts.forEach((count) => {
            it(`handles draw with ${count} participants and logs fee delta`, async () => {
                const drawId = 1000 + count;
                const minEntryAmount = toNano('1');
                // slightly less than total contributions to ensure payout triggers
                const entryLimit = minEntryAmount * BigInt(count) - 1n;
                const createValue = toNano('0.5');

                await randomWin.sendCreateDraw(deployer.getSender(), {
                    queryId: 1n,
                    drawId,
                    minEntryAmount,
                    entryLimit,
                    value: createValue,
                });

                const participants: string[] = [];
                const startBalance = (await blockchain.getContract(randomWin.address)).balance;
                const totalIncome = minEntryAmount * BigInt(count);

                let result: SendMessageResult | undefined;
                for (let i = 0; i < count; i++) {
                    const roller = await blockchain.treasury(`roller-${count}-${i}`);
                    participants.push(roller.address.toString());
                    result = await randomWin.sendLuckRoll(roller.getSender(), {
                        queryId: BigInt(i + 2),
                        drawId,
                        value: minEntryAmount,
                    });
                    expect(result.transactions).toHaveTransaction({
                        from: roller.address,
                        to: randomWin.address,
                        success: true,
                    });
                }

                expect(result!.transactions).toHaveTransaction({
                    from: randomWin.address,
                    to: (addr) => addr !== undefined && participants.includes(addr.toString()),
                    success: true,
                });

                const endBalance = (await blockchain.getContract(randomWin.address)).balance;
                const delta = endBalance - startBalance; // end-start
                const poolSum = createValue + totalIncome;
                const payout = (poolSum * 99n) / 100n;
                const netAfterIncome = endBalance - startBalance - totalIncome; // effect after subtracting all incoming bets
                const gasDelta = netAfterIncome + payout; // how much we lost to gas vs ideal (-payout)
                console.log(
                    `participants=${count} | start=${startBalance} end=${endBalance} delta(end-start)=${delta} nanoton | totalIncome=${totalIncome} payout=${payout} netAfterIncome=${netAfterIncome} gas delta=${gasDelta}`
                );

                const drawAfter = await randomWin.getDraw(drawId);
                expect(drawAfter).toBeNull();
            });
        });
    });

    describe('Empty body transfer', () => {
        it('ignores an internal message with empty body (does not touch storage)', async () => {
            const drawId = 1;
            await randomWin.sendCreateDraw(deployer.getSender(), {
                queryId: 1n,
                drawId,
                minEntryAmount: toNano('1'),
                entryLimit: toNano('10'),
                value: toNano('0.1'),
            });

            const before = await randomWin.getDraw(drawId);
            expect(before).not.toBeNull();

            const result = await deployer.send({
                to: randomWin.address,
                value: toNano('0.2'),
                body: beginCell().endCell(), // empty body
            });

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: randomWin.address,
                success: true,
            });

            const after = await randomWin.getDraw(drawId);
            expect(after).not.toBeNull();
            expect(after!.poolSum).toBe(before!.poolSum);
            expect(after!.participantCounter).toBe(before!.participantCounter);
            expect(after!.participants.size).toBe(before!.participants.size);
        });
    });

    describe('Invalid opcode', () => {
        it('fails with ERROR_WRONG_OP', async () => {
            const result = await deployer.send({
                to: randomWin.address,
                value: toNano('0.05'),
                body: beginCell().storeUint(0xdeadbeef, 32).storeUint(1n, 64).endCell(),
            });

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: randomWin.address,
                success: false,
                exitCode: 0xffff,
            });
        });
    });
});
