const { Client } = require('pg');
const client = new Client('postgresql://spenit:spenit@localhost:5432/spenit');

client.connect()
  .then(() => client.query('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS groq_api_key text;'))
  .then(() => {
    console.log('Column groq_api_key added to User table');
    process.exit(0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
