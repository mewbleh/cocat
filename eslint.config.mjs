import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [".next/**", "node_modules/**", "coverage/**", "test-results/**", "playwright-report/**"]
  },
  ...nextVitals,
  ...nextTypescript
];

export default eslintConfig;
