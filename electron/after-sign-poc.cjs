// The POC preserves the ECS development signature in after-pack.cjs.
// Production VMP signing is intentionally reserved for the release build.
module.exports = async function skipProductionSigningForPoc() {}
