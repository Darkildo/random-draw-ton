import "errors"
import "messages"
import "models"
import "storage"

type AllowedMessage = LuckRoll | CreateDraw | TopUpTons

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
            if (draw.minEntryAmount > in.valueCoins) {
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

            draw.poolSum += in.valueCoins;

            if (draw.poolSum >= draw.entryAmountLimit) {
                random.initialize();
                val winnerIndex = random.range(draw.participantCounter);

                var entry = draw.participants.findFirst();
                var i = 0;
                while (entry.isFound && i < winnerIndex) {
                    i += 1;
                    entry = draw.participants.iterateNext(entry);
                }
                if (!entry.isFound) {
                    throw ERROR_WINNER_NOT_FOUND;
                }
                val winnerAddress = entry.getKey();

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
            var draw = Draw {
                minEntryAmount: msg.minEntryAmount,
                entryAmountLimit: msg.entryLimit,
                poolSum: in.valueCoins,
                participants: createEmptyMap(),
            };

            storage.drawMap.set(msg.drawId, draw);

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
