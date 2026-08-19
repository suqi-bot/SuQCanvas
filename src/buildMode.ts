/**
 * 构建目标：'lan'（局域网版）或 'online'（在线版）。
 * 由构建时的 VITE_BUILD_TARGET 环境变量决定（.env.lan / .env.online），
 * 未设置时默认为 online。构建时会被替换为字面量，死分支代码将被摇树移除。
 */
export const IS_LAN_BUILD: boolean = import.meta.env.VITE_BUILD_TARGET === 'lan'
export const IS_ONLINE_BUILD: boolean = import.meta.env.VITE_BUILD_TARGET !== 'lan'
