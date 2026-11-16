import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

/**
 * Reads a SecureString parameter once per container and keeps it in memory.
 * Parameter Store rather than Secrets Manager, so an idle stack costs nothing.
 */
export function ssmSecret(name: string, ssm = new SSMClient({})): () => Promise<string> {
  let cached: Promise<string> | undefined;
  return () => {
    cached ??= ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true })).then((out) => {
      const value = out.Parameter?.Value;
      if (!value) throw new Error(`parameter ${name} is empty`);
      return value;
    });
    // A failed read is not cached, so the next invocation tries again.
    cached.catch(() => (cached = undefined));
    return cached;
  };
}
