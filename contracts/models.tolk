struct Draw {
    minEntryAmount: coins
    entryAmountLimit: coins
    poolSum: coins = 0
    participantCounter: uint32 = 0
    participants: map<address, coins>
}
