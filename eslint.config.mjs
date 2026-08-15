import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored minified opus-recorder encoder worker (served statically).
    "public/opus/**",
  ]),

  // ============================================================
  // Company-area link safety
  //
  // A link that drops the company is a silent failure: the address still
  // looks valid, the page around it renders, and it only 404s when
  // somebody clicks — usually from inside a condition that no walkthrough
  // exercises. So the bad link is made unwritable rather than discouraged.
  //
  // Inside a company area the only way to link is <CompanyLink to="...">,
  // which reads the company from context and takes a route from a closed
  // union. These rules close the two escape hatches: importing next/link
  // directly, and hand-writing an href. Both fail lint, which runs in CI —
  // before a browser ever sees the page.
  // ============================================================
  {
    files: [
      // Brackets are escaped: in a glob, [company] is a CHARACTER CLASS
      // matching one of c,o,m,p,a,n,y — so the unescaped form silently
      // matches nothing and the rule protects nothing while looking
      // perfectly configured.
      "src/app/\\[company\\]/**/*.tsx",
      "src/app/\\[company\\]/**/*.ts",
      "src/components/inbox/**/*.tsx",
      "src/components/layout/**/*.tsx",
      "src/components/settings/**/*.tsx",
      "src/components/search/**/*.tsx",
    ],
    ignores: ["src/components/tenancy/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/link",
              message:
                "Inside a company area, use <CompanyLink to=\"...\"> from @/components/tenancy/company-link. A raw next/link can omit the company, which 404s only when clicked.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXAttribute[name.name='href'][value.type='Literal'][value.value=/^\\//]",
          message:
            "Absolute href inside a company area drops the company. Use <CompanyLink to=\"...\"> or companyPath(slug, route).",
        },
        {
          selector:
            "JSXAttribute[name.name='href'] JSXExpressionContainer > TemplateLiteral[quasis.0.value.raw=/^\\//]",
          message:
            "Template-literal href starting with '/' drops the company. Use companyPath(slug, route) so the company cannot be forgotten.",
        },
        {
          selector:
            "CallExpression[callee.property.name=/^(push|replace)$/] > Literal.arguments:first-child[value=/^\\/(?!login|signup|forgot-password|join|$)/]",
          message:
            "router.push/replace with an absolute path drops the company. Use companyPath(slug, route).",
        },
      ],
    },
  },

  // ============================================================
  // RLS bypass containment
  //
  // Ordinary code talks to Supabase as the signed-in user, so RLS decides
  // visibility and a query that forgets to filter by company returns
  // nothing rather than someone else's rows. The service-role key removes
  // that guarantee entirely, so reading it is confined to one module whose
  // name says what it is. Anywhere else it is a lint error — the wrong
  // thing becomes inconvenient to express rather than something to
  // remember in review.
  // ============================================================
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/lib/supabase/privileged.ts", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='SUPABASE_SERVICE_ROLE_KEY']",
          message:
            "The service-role key bypasses row-level security. Obtain a bypassing client from privilegedClient(reason) in @/lib/supabase/privileged, which records why — do not read the key directly.",
        },
      ],
    },
  },
]);

export default eslintConfig;
