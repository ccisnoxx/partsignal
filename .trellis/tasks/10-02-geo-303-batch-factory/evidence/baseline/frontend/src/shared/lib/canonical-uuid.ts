import { z } from 'zod';

const canonicalUuidSchema = z.uuid().transform((value) => value.toLowerCase());

function canonicalUuid(value: string) {
  return canonicalUuidSchema.parse(value);
}

export { canonicalUuid, canonicalUuidSchema };
