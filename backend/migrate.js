const { Client } = require('pg');
require('dotenv').config();

const client = new Client(process.env.DATABASE_URL || 'postgresql://spenituser:spenit_password_123@localhost:5432/spenit');

client.connect()
  .then(() => client.query('ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS receipt_data jsonb;'))
  .then(() => {
    console.log('Column receipt_data added to Expense table');
    process.exit(0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
