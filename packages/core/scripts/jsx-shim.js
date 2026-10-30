import { createElement, Fragment } from 'react'
const jsx = (type, props, key) => createElement(type, key === undefined ? props : { ...props, key })
export { jsx, jsx as jsxs, Fragment }
