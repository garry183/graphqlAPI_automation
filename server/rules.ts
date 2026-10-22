import { GraphQLError, Kind, type SelectionSetNode, type ValidationContext, type ValidationRule } from 'graphql';
import type { Plugin } from 'graphql-yoga';

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

const SUGGESTION = /\s*Did you mean [\s\S]*$/;
const strip = <E extends Error>(errors: readonly E[]) =>
  errors.map((e) =>
    e instanceof GraphQLError && SUGGESTION.test(e.message)
      ? new GraphQLError(e.message.replace(SUGGESTION, ''), { nodes: e.nodes, source: e.source, positions: e.positions, path: e.path, originalError: e.originalError, extensions: e.extensions })
      : e,
  );

/**
 * "Did you mean ...?" hints leak field and type names even with introspection
 * off: an attacker can rebuild the schema by guessing. They come from two places,
 * query validation and variable coercion (misspelled input fields), so both are stripped.
 */
export const noSuggestions: Plugin = {
  onValidate: () => ({ result, setResult }) => {
    if (result.length) setResult(strip(result));
  },
  onExecute: () => ({
    onExecuteDone({ result, setResult }) {
      if (!(Symbol.asyncIterator in result) && result.errors?.length) setResult({ ...result, errors: strip(result.errors) });
    },
  }),
};
