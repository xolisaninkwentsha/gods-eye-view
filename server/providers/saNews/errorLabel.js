// An error as a code or name only, for the SA news logs: a message or body
// may carry anything. A string code, else a string cause code, else the
// error's name, at most 40 characters.
export function errorLabel(error) {
  if (typeof error?.code === 'string') return error.code.slice(0, 40);
  if (typeof error?.cause?.code === 'string')
    return error.cause.code.slice(0, 40);
  return String(error?.name || 'Error').slice(0, 40);
}
