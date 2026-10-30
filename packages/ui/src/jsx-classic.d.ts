// JSX here compiles to h() calls (tsconfig: jsx react, jsxFactory h), because the host
// shell seeds only react, react-dom and the ui primitives: a bundle that requires
// react/jsx-runtime fails to resolve in the browser and the client never registers.
//
// The classic transform resolves element types from the global JSX namespace, which
// @types/react 19 no longer declares (it keeps React.JSX). This maps one onto the other
// so .tsx sources still typecheck.
import type React from 'react'

declare global {
  namespace JSX {
    interface Element extends React.JSX.Element {}
    interface ElementClass extends React.JSX.ElementClass {}
    interface ElementAttributesProperty extends React.JSX.ElementAttributesProperty {}
    interface ElementChildrenAttribute extends React.JSX.ElementChildrenAttribute {}
    interface IntrinsicAttributes extends React.JSX.IntrinsicAttributes {}
    interface IntrinsicClassAttributes<T> extends React.JSX.IntrinsicClassAttributes<T> {}
    interface IntrinsicElements extends React.JSX.IntrinsicElements {}
  }
}
