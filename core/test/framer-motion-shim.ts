// The sidebar test renders components with a minimal React stand-in, so it does
// not load the real animation runtime.
const passthrough = ({ children }) => children
export const Reorder = { Group: passthrough, Item: passthrough }
export const AnimatePresence = passthrough
export const motion = { div: passthrough, aside: passthrough }
