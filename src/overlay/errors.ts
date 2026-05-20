export class NotImplemented extends Error {
  readonly operator: string;
  readonly vector: string;
  constructor(operator: string, vector: string, detail?: string) {
    super(`NotImplemented: ${operator} vector='${vector}'${detail ? ` — ${detail}` : ''}`);
    this.name = 'NotImplemented';
    this.operator = operator;
    this.vector = vector;
  }
}
