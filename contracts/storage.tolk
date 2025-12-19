import "models"

struct Storage {
    owner: address
    fee: uint16
    drawMap: map<uint32, Draw>
    minCoinsToDraw: coins
}

fun Storage.load() {
    return Storage.fromCell(contract.getData());
}

fun Storage.save(self) {
    contract.setData(self.toCell());
}
