// Raw driver inserts for the removal undos, which put rows back verbatim (their own ids, no schema
// defaults, no validation of an old shape a newer schema would refuse).

/**
 * Insert these documents, each that lands kept: the indexes a duplicate key refused come back. Anything
 * else throws — the driver wraps a dropped connection, a stepdown or any failure of the whole command as
 * a bulk error with NO write errors, and reading that empty list as "nothing clashed" let an undo delete
 * the copies of answers it never wrote (code review round 6). A write-concern error throws too.
 */
export const insertAllowingDuplicates = async (collection, docs) => {
  if (!docs.length) return new Set();
  try {
    await collection.insertMany(docs, { ordered: false });
    return new Set();
  } catch (e) {
    // The driver reports one write error as an object, several as an array.
    const raw = e?.writeErrors ?? (e?.code === 11000 && docs.length === 1 ? [{ index: 0, code: 11000 }] : null);
    const errs = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
    const writeConcern = !!e?.result?.getWriteConcernError?.() || !!e?.writeConcernError;
    if (!errs.length || writeConcern || !errs.every((w) => (w?.code ?? w?.err?.code) === 11000)) throw e;
    return new Set(errs.map((w) => w.index ?? w.err?.index));
  }
};

/** Which of these ids are on file now — what an insert actually wrote, read back rather than inferred. */
export const idsOnFile = async (collection, ids) =>
  new Set((ids.length ? await collection.find({ _id: { $in: ids } }, { projection: { _id: 1 } }).toArray() : []).map((x) => String(x._id)));
