export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class DuplicateGrantError extends Error {
  constructor(public grantNumber: string) {
    super(`A grant with number "${grantNumber}" already exists`);
    this.name = "DuplicateGrantError";
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public issues: Array<{ path: string; message: string }> = [],
  ) {
    super(message);
    this.name = "ValidationError";
  }
}
