// npm run invite -- someone@gmail.com           allow sign-in
// npm run invite -- --remove someone@gmail.com  revoke, and end their sessions
// Runs as the database owner: the app role cannot modify the allowlist.
import postgres from 'postgres'
import { env } from './env.ts'

const args = process.argv.slice(2)
const remove = args[0] === '--remove'
const email = args[remove ? 1 : 0]
if (!email?.includes('@')) {
  console.error('usage: invite [--remove] <email>')
  process.exit(1)
}

const sql = postgres(env('MIGRATE_DATABASE_URL'))
if (remove) {
  await sql`delete from allowed_emails where email = ${email}`
  await sql`delete from sessions where user_id = (select id from users where email = ${email})`
  console.log('removed', email, '(vault data kept)')
} else {
  await sql`insert into allowed_emails (email) values (${email}) on conflict do nothing`
  console.log('invited', email)
}
await sql.end()
