// The catalog in React (milestone 66): useT() re-renders a component when the language
// changes, and tr() puts elements (a <Kbd>, a <b>) where a text has `{name}`.

import { createContext, Fragment, useContext, type ReactNode } from 'react';
import { find, t, type Lang, type Params } from './index';

export const LanguageContext = createContext<Lang>('en');

/** The translate function, subscribed to the language. */
export function useT(): typeof t {
  useContext(LanguageContext);
  return t;
}

/** `key`'s text with each `{name}` replaced by nodes[name], or params[name] for text. */
export function tr(key: string, nodes: Record<string, ReactNode>, params?: Params): ReactNode {
  const text = find(key, params);
  if (text === undefined) return t(key, params);
  const parts = text.split(/\{(\w+)\}/g);
  return parts.map((p, i) => {
    if (i % 2 === 0) return p === '' ? null : <Fragment key={i}>{p}</Fragment>;
    if (p in nodes) return <Fragment key={i}>{nodes[p]}</Fragment>;
    const v = params?.[p];
    return <Fragment key={i}>{v === undefined && !(params && p in params) ? `{${p}}` : String(v)}</Fragment>;
  });
}
