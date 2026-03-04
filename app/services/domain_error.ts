export class DomainError<TCode extends string = string> extends Error {
  constructor(readonly code: TCode) {
    super(code)
    this.name = 'DomainError'
  }
}

export function isDomainError<TCode extends string>(
  error: unknown,
  code?: TCode
): error is DomainError<TCode> {
  if (!(error instanceof DomainError)) {
    return false
  }

  return code ? error.code === code : true
}
