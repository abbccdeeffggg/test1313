# AA+ Firestore Security Specification

## 1. Data Invariants
1. Every document under `/users/{userId}` belongs strictly to the authenticated, email-verified user whose `request.auth.uid == userId`.
2. Every `Device`, `UsagePreset`, and `ReplacementLog` document must store `ownerId == request.auth.uid`, and `ownerId` and `createdAt` are immutable after creation.
3. Every `ReplacementLog` must reference an existing `Device` document under the same owner (`/users/{userId}/devices/{deviceId}`).
4. All string lengths, numeric ranges (`batteryCount` 1..24, `dailyHours` 0..24, `calibrationFactor` 0.1..10), and enum values are enforced on both create and update.
5. No unauthenticated reads/writes or cross-user access are permitted anywhere.

## 2. Adversarial "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. Unauthenticated read on `/users/userA/devices/dev1` -> DENIED.
2. Cross-user read/list by `userB` on `/users/userA/devices` -> DENIED.
3. Unverified email user attempting create on `/users/userA/devices/dev1` -> DENIED.
4. Identity spoofing: `userA` creating `/users/userA/devices/dev1` with `ownerId: "userB"` -> DENIED.
5. Shadow field injection: creating a Device with extra unknown key `isVerified: true` -> DENIED.
6. ID poisoning: creating a Device with document ID longer than 128 chars or containing `$` / `/` -> DENIED.
7. Resource exhaustion: setting `name` to a 500-char string (> 80 max) -> DENIED.
8. Invalid battery type enum: setting `batteryType: "PLUTONIUM"` -> DENIED.
9. Timestamp spoofing: creating a Device with client-forged `createdAt` not equal to `request.time` -> DENIED.
10. Immutable field mutation: updating `ownerId` or `createdAt` on an existing Device -> DENIED.
11. Orphaned replacement log: creating a `ReplacementLog` pointing to a non-existent `deviceId` -> DENIED.
12. Value poisoning on update: updating `predictedTotalDays` to a string `"infinite"` -> DENIED.
