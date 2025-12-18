import { Dictionary, toNano } from '@ton/core';
import { RandomWin } from '../wrappers/RandomWin';
import { compile, NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const adminWallet = await provider.ui().inputAddress("get admin address");
    const randomWin = provider.open(
        RandomWin.createFromConfig(
            {

                owner: adminWallet,
                fee: 0,
                drawMap: Dictionary.empty(),
            },
            await compile('RandomWin')
        )
    );

    await randomWin.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(randomWin.address);

    console.log('ID', await randomWin.getDraw(0));
}
