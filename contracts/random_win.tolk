import "errors"
import "messages"
import "models"
import "storage"

type AllowedMessage = LuckRoll | CreateDraw | TopUpTons | UpdateContractData

fun onInternalMessage(in: InMessage) {
    if (in.body.isEmpty()) {
        return;
    }
    val msg = lazy AllowedMessage.fromSlice(in.body);
    var storage = lazy Storage.load();

    match (msg) {
        LuckRoll => {
            var drawResult = storage.drawMap.get(msg.drawId);

            if (!drawResult.isFound) {
                throw ERROR_DRAW_NOT_FOUND;
            }

            var draw = drawResult.loadValue();

            // Refund: return remaining incoming value back to sender
            if (draw.minEntryAmount > (in.valueCoins - in.originalForwardFee)) {
                val reply = createMessage({
                    bounce: BounceMode.Only256BitsOfBody,
                    value: 0,
                    dest: in.senderAddress,
                });
                reply.send(SEND_MODE_CARRY_ALL_REMAINING_MESSAGE_VALUE);
                return;
            }

            // Update participants first so the last bet is included in the draw.
            var participant = draw.participants.get(in.senderAddress);
            if (participant.isFound) {
                var previosBalance = participant.loadValue();
                previosBalance += in.valueCoins;
                draw.participants.set(in.senderAddress, previosBalance);
            } else {
                draw.participantCounter += 1;
                draw.participants.set(in.senderAddress, in.valueCoins);
            }

            draw.poolSum += in.valueCoins - in.originalForwardFee;

            if (draw.poolSum >= draw.entryAmountLimit) {
                random.initialize();

                var addrChain = beginCell().endCell();
                var hasAddr = false;
                var indexMap = createEmptyMap<uint32, address>();
                var entry = draw.participants.findFirst();
                var idx: uint32 = 0;
                while (entry.isFound) {
                    val addr = entry.getKey();
                    var itemBuilder = beginCell();
                    itemBuilder.storeAddress(addr);
                    if (hasAddr) {
                        itemBuilder.storeRef(addrChain);
                    }
                    addrChain = itemBuilder.endCell();
                    hasAddr = true;
                    indexMap.set(idx, addr);
                    idx += 1;
                    entry = draw.participants.iterateNext(entry);
                }

                // Mix addresses hash + current seed + current time to derive entropy.
                var addrHash = addrChain.hash();
                if (!hasAddr) {
                    addrHash = beginCell().endCell().hash();
                }
                val entropyCell = beginCell().storeUint(addrHash, 256).storeUint(
                    random.getSeed(),
                    256
                )
                    .storeInt(blockchain.now(), 64)
                    .endCell();
                val entropy = entropyCell.hash();

                val winnerIndex = entropy % draw.participantCounter;
                val winnerAddress = indexMap.mustGet(winnerIndex);

                val payout = (draw.poolSum * (100 - storage.fee)) / 100;
                val reply = createMessage({
                    bounce: BounceMode.Only256BitsOfBody,
                    value: payout,
                    dest: winnerAddress,
                });
                reply.send(SEND_MODE_REGULAR);

                var deleteResult = storage.drawMap.delete(msg.drawId);
                storage.save();
                if (!deleteResult) {
                    throw ERROR_DELETE_DRAW_AFTER_PAYMENT;
                }
                return;
            }

            storage.drawMap.set(msg.drawId, draw);
            storage.save();
        }
        CreateDraw => {
            var drawResult = storage.drawMap.get(msg.drawId);

            if (drawResult.isFound) {
                throw ERROR_DRAW_ALREADY_EXISTS;
            }
            if (msg.minEntryAmount < storage.minCoinsToDraw) {
                throw ERROR_MIN_LIMIT_TO_DRAW;
            }

            var draw = Draw {
                minEntryAmount: msg.minEntryAmount,
                entryAmountLimit: msg.entryLimit,
                poolSum: in.valueCoins,
                participants: createEmptyMap(),
            };

            storage.drawMap.set(msg.drawId, draw);

            storage.save();
        }
        UpdateContractData => {
            if (in.sender != storage.owner) {
                throw ERROR_NOT_OWNER;
            }
            if (msg.fee != null) {
                storage.fee = msg.fee;
            }
            if (msg.minCoinsToDraw != null) {
                storage.minCoinsToDraw = msg.minCoinsToDraw;
            }
            storage.save();
        }
        TopUpTons => {
            return;
        }
        else => {
            throw ERROR_WRONG_OP;
        }
    }
}

fun onBouncedMessage(in: InMessageBounced) {}

get fun get_owner() {
    return Storage.load().owner;
}

get fun get_draw(drawId: uint32) {
    var storage = lazy Storage.load();
    var drawResult = storage.drawMap.get(drawId);

    if (!drawResult.isFound) {
        return null;
    }
    return drawResult.loadValue();
}
