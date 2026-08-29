// Client-minted Mongo ObjectIds for walk-up voters (Add person at the door).
//
// Why the CLIENT mints the id: the offline queue (lib/offlineQueue.js) replays verbatim
// paths FIFO and drops non-auth 4xx — so the survey queued behind an offline add must
// reference an id that survives the replay. The create endpoint treats this value as the
// voter's real _id and is idempotent on it (a replay returns 200 with the existing row),
// which is what keeps a queued create+survey pair intact across any number of retries.
//
// Shape matches a real ObjectId: 4-byte seconds timestamp + 8 random bytes, 24 hex chars.
// The timestamp prefix keeps ids roughly insertion-sorted like server-minted ones; the 8
// random bytes (~2^64) make a collision with any other id practically impossible — and the
// server answers a genuine collision with a 409 rather than corrupting anything.
export const newObjectIdHex = () => {
  const ts = Math.floor(Date.now() / 1000)
    .toString(16)
    .padStart(8, '0');
  let rand = '';
  for (let i = 0; i < 16; i++) rand += Math.floor(Math.random() * 16).toString(16);
  return ts + rand;
};
