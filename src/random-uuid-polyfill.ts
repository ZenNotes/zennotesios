/**
 * main.tsx imports this first, so crypto.randomUUID exists on iOS 15.0 to
 * 15.3 before boot() runs anything. The core and this app's bridge already
 * route their own calls through a getRandomValues fallback; this covers
 * dependencies that call crypto.randomUUID directly. Rolldown still
 * evaluates the shared chunks the entry imports ahead of this module, so no
 * module may call crypto.randomUUID at load time; none does today, every
 * call sits inside a function that runs after boot starts.
 */
import { installRandomUUIDPolyfill } from './bridge/uuid'

installRandomUUIDPolyfill()
