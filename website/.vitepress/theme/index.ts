import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import Layout from './Layout.vue'
import Playground from './components/Playground.vue'
import './custom.css'
import { initFaro } from './faro'

export default {
  extends: DefaultTheme,
  // 自定义 Layout：注入首页 hero 的 LiveTicker / HeroMeta / 次级链接插槽
  Layout,
  enhanceApp({ app }) {
    // 注册全局组件
    app.component('Playground', Playground)

    // 初始化 Grafana Faro 监控
    initFaro()
  },
} satisfies Theme

