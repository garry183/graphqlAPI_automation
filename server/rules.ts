import { GraphQLError, Kind, type SelectionSetNode, type ValidationContext, type ValidationRule } from 'graphql';

function depthOf(set: SelectionSetNode | undefined, depth: number, ctx: ValidationContext, seen: ReadonlySet<string>): number {
  if (!set) return depth;
  let max = depth;
  for (const sel of set.selections) {
    if (sel.kind === Kind.FIELD) {
      if (sel.name.value.startsWith('__')) continue;
      max = Math.max(max, depthOf(sel.selectionSet, depth + 1, ctx, seen));
    } else if (sel.kind === Kind.INLINE_FRAGMENT) {
      max = Math.max(max, depthOf(sel.selectionSet, depth, ctx, seen));
    } else {
      // Follow spreads so depth can't be hidden behind fragments; `seen` stops cycles.
      const name = sel.name.value;
      const frag = ctx.getFragment(name);
      if (frag && !seen.has(name)) max = Math.max(max, depthOf(frag.selectionSet, depth, ctx, new Set([...seen, name])));
    }
  }
  return max;
}

export const depthLimit = (limit: number): ValidationRule => (ctx) => ({
  OperationDefinition(node) {
    const depth = depthOf(node.selectionSet, 0, ctx, new Set());
    if (depth > limit) {
      ctx.reportError(new GraphQLError(`Query depth ${depth} exceeds limit ${limit}`, { nodes: [node], extensions: { code: 'DEPTH_LIMIT_EXCEEDED' } }));
    }
  },
});

export const aliasLimit = (limit: number): ValidationRule => (ctx) => {
  let aliases = 0;
  return {
    Field(node) {
      if (node.alias) aliases++;
    },
    Document: {
      leave(node) {
        if (aliases > limit) {
          ctx.reportError(new GraphQLError(`${aliases} aliases exceeds limit ${limit}`, { nodes: [node], extensions: { code: 'ALIAS_LIMIT_EXCEEDED' } }));
        }
      },
    },
  };
};
