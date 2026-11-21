import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import HomeStory from './HomeStory.vue';
import './aurora.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('HomeStory', HomeStory);
  },
} satisfies Theme;
