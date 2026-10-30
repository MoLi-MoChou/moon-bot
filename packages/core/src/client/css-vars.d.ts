/** Allow CSS custom properties on style objects (classic JSX). */
import type {} from 'csstype'
declare module 'csstype' {
  interface Properties {
    [key: `--${string}`]: string | number | undefined
  }
}
