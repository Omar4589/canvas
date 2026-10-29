// A password that isn't well-formed text never reaches bcrypt.
//
// bcryptjs 2.4.3 (the one installed) runs out of memory on a lone surrogate — half of a UTF-16 pair,
// which no keyboard types but a crafted JSON body ("\ud800") can send — and V8 then ends the whole
// process. One request to sign-in, or to a client link's password page, took the web dyno down
// (found 2026-10-28 in the client report links plan review; reproduced, exit 134). A try/catch can't
// stop an out-of-memory exit, so every path that hands a password to bcrypt checks this first. No real
// password contains one: at sign-in it simply doesn't match; where a password is being set, it's
// refused.
export const isWellFormedText = (s) => typeof s === 'string' && s.isWellFormed();
