// Paste into the devtools console while logged in to https://web.toddleapp.com
// (or adjust ENDPOINT). Downloads a full introspection result as JSON.
(async () => {
  const ENDPOINT = "https://apigw.toddleapp.com/graphql";
  const q = `
    query IntrospectionQuery {
      __schema {
        queryType { name }
        mutationType { name }
        subscriptionType { name }
        types { ...FullType }
        directives { name description locations args { ...InputValue } }
      }
    }
    fragment FullType on __Type {
      kind name description
      fields(includeDeprecated: true) {
        name description
        args { ...InputValue }
        type { ...TypeRef }
        isDeprecated deprecationReason
      }
      inputFields { ...InputValue }
      interfaces { ...TypeRef }
      enumValues(includeDeprecated: true) { name description isDeprecated deprecationReason }
      possibleTypes { ...TypeRef }
    }
    fragment InputValue on __InputValue {
      name description type { ...TypeRef } defaultValue
    }
    fragment TypeRef on __Type {
      kind name
      ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } }
    }
  `;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  if (!res.ok) {
    console.error("HTTP", res.status, await res.text());
    return;
  }
  const body = await res.json();
  if (body.errors) console.warn("errors:", body.errors.slice(0, 3));
  const blob = new Blob([JSON.stringify(body.data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "introspection.json";
  a.click();
  console.log("downloaded introspection.json", body.data && body.data.__schema ? "OK" : "EMPTY");
})();
