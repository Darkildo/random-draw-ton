struct (0x0f1a3ea5) LuckRoll {
    queryId: uint64
    drawId: uint32
}

struct (0x7e8764ef) CreateDraw {
    queryId: uint64
    drawId: uint32 // id of draw
    minEntryAmount: coins // min limit to play
    entryLimit: coins // start play after collect to limit
}

struct (0xd372158c) TopUpTons {}
