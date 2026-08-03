// Force dynamic ESM import (TypeScript compile to CJS breaks normal import())
export async function dynamicImport(specifier: string): Promise<any> {
  return new Function('specifier', 'return import(specifier)')(specifier);
}
