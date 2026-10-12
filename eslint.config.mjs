import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", "node_modules/**", "storage/**", "next-env.d.ts", "coverage/**", "e2e/screenshots/**"] },
  ...coreWebVitals,
  ...typescript,
  { rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }] } },
];

export default config;
