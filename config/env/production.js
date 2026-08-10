// Deliberately identical to development.js today: the original db/sequelize.js read
// these same fallback values regardless of NODE_ENV (there was no environment
// branching at all before this refactor). docker-compose.yml sets NODE_ENV=production
// for the container, so if these two files ever diverge, double-check that's actually
// intended and not an accidental behavior change for the deployed environment.
//
// (The original file also carried a commented-out alternate DB_HOST/DB_PASSWORD pair
// for a remote host — '159.228.251.212' / 'D@!cel009' — never active, just a
// developer's leftover note for manually pointing at that server. Preserved here for
// context, still inert.)
export default {
  PORT: 1312,
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_USER: 'root',
  DB_PASSWORD: '12345',
  DB_NAME: 'contract_db',
};
