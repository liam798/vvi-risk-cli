export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('../src/') && specifier.endsWith('.js')) {
    return {
      shortCircuit: true,
      url: new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL).href,
    }
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js') && context.parentURL.includes('/src/')) {
    return {
      shortCircuit: true,
      url: new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL).href,
    }
  }
  return nextResolve(specifier, context)
}
