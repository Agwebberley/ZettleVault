export function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`missing env var ${name}`)
  return value
}
