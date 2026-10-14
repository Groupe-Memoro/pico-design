import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import CodeBlock from "@/components/CodeBlock";

// Page Aide : intégrer Pico Design à une boutique Shopify, pas à pas. Ouverte
// par l'icône d'aide de la barre du haut (voir Nav). Les blocs de code sont
// ceux à coller dans le thème ; la clé du lien n'y figure jamais (elle se
// garde dans le gestionnaire de mots de passe), seulement son emplacement.

const SITE = "https://pico-design.vercel.app";
const WEBHOOK_URL = `${SITE}/api/shopify/webhook`;

const PRODUCT_BLOCK = String.raw`{%- comment -%}
  Pico Design : bouton « Débuter votre création », et ajout automatique au panier au
  retour de l'outil.

  Modèle Pico (id copié depuis Pico Design > Modèles), lu d'abord sur la
  VARIANTE (métachamp custom.custom_pico_template, ou custom.pico_template),
  puis sur le PRODUIT à défaut (custom.pico_template). Une variante sans modèle (ni sur elle, ni sur le produit) n'est
  pas personnalisable. Si aucune ne l'est, rien ne s'affiche.
{%- endcomment -%}
{%- assign pico_default = product.metafields.custom.pico_template.value -%}
{%- assign pico_any = false -%}
{%- capture pico_map -%}{
  {%- for v in product.variants -%}
    {%- assign pico_t = v.metafields.custom.custom_pico_template.value | default: v.metafields.custom.pico_template.value | default: pico_default -%}
    {%- if pico_t != blank -%}{%- assign pico_any = true -%}{%- endif -%}
    "{{ v.id }}": {{ pico_t | default: '' | json }}{% unless forloop.last %},{% endunless %}
  {%- endfor -%}
}{%- endcapture -%}
{%- capture pico_titles -%}{
  {%- for v in product.variants -%}
    {{ v.title | json }}: "{{ v.id }}"{% unless forloop.last %},{% endunless %}
  {%- endfor -%}
}{%- endcapture -%}
{%- if pico_any -%}
  <style>
    .pico-design { margin: 1rem 0; }
    .pico-design__link { width: 100%; }
    .pico-design__link[hidden] { display: none; }
    .pico-design__status { margin: 0 0 0.5rem; font-size: 0.9em; }
  </style>
  <div class="pico-design" data-templates="{{ pico_map | escape }}" data-variants="{{ pico_titles | escape }}">
    <p class="pico-design__status" hidden></p>
    <button type="button" class="btn btn--md btn--primary pico-design__link">
      <span>Débuter votre création</span>
    </button>
  </div>
  <script>
    (function () {
      var TOOL = "${SITE}/design";
      var KEY = "VOTRE_DESIGN_LINK_KEY";
      // Domaine .myshopify.com (adresse de retour) et domaine que voit le
      // client (habillage). Le navigateur prend le relais si Liquid ne les
      // fournit pas.
      var SHOP = "https://" + ("{{ shop.permanent_domain }}" || (window.Shopify && window.Shopify.shop) || "");
      var BOUTIQUE = "{{ shop.domain }}" || location.hostname;
      var CART_ADD = "{{ routes.cart_add_url }}.js";
      var CART = "{{ routes.cart_url }}";
      var FIRST_VARIANT = "{{ product.selected_or_first_available_variant.id }}";

      var root = document.currentScript.previousElementSibling;
      var status = root.querySelector(".pico-design__status");
      var link = root.querySelector(".pico-design__link");

      var templates = {};
      var variantsByTitle = {};
      try { templates = JSON.parse(root.dataset.templates); } catch (err) {}
      try { variantsByTitle = JSON.parse(root.dataset.variants); } catch (err) {}

      // Relus à chaque fois : certains thèmes remplacent ces éléments au
      // changement de variante.
      function value(name, fallback) {
        var forms = document.querySelectorAll('form[action*="/cart/add"]');
        for (var i = 0; i < forms.length; i++) {
          var el = forms[i].querySelector('[name="' + name + '"]');
          if (el && el.value) return el.value;
        }
        return fallback;
      }
      // Quantité : le palier choisi dans Bundler (quantity breaks) s'il y en
      // a un, sinon un champ « quantity » de la page, sinon 1.
      function currentQuantity() {
        var bundle = document.querySelector('input[name="bundle_quantity"]:checked');
        if (bundle && parseInt(bundle.value, 10) > 0) return bundle.value;
        var field = document.querySelector('[name="quantity"]');
        if (field && parseInt(field.value, 10) > 0) return field.value;
        return "1";
      }
      // Options cochées dans le sélecteur de variantes (« Recto-verso /
      // Glacé deux côtés / … ») : lues directement, elles ne dépendent pas du
      // script du thème, qui peut échouer à mettre la variante à jour.
      function variantFromOptions() {
        var picker = document.querySelector("variant-picker, variant-selects, variant-radios, [data-variant-picker]");
        if (!picker) return "";
        var values = [];
        var fields = picker.querySelectorAll("input[type=radio]:checked, select");
        for (var i = 0; i < fields.length; i++) values.push(fields[i].value);
        return variantsByTitle[values.join(" / ")] || "";
      }
      // Variante choisie : le formulaire du panier s'il existe, sinon les
      // options cochées, sinon le sélecteur (Aurora : JSON de la variante
      // choisie), sinon ?variant= dans l'adresse, sinon la variante de départ.
      function currentVariant() {
        var fromForm = value("id", "");
        if (fromForm) return fromForm;
        var fromOptions = variantFromOptions();
        if (fromOptions) return fromOptions;
        var json = document.querySelector("[data-selected-variant-json]");
        if (json) {
          try {
            var v = JSON.parse(json.textContent);
            if (v && v.id) return String(v.id);
          } catch (err) {}
        }
        return new URLSearchParams(location.search).get("variant") || FIRST_VARIANT;
      }
      function say(text) {
        status.textContent = text;
        status.hidden = !text;
      }
      function currentTemplate() {
        return templates[currentVariant()] || "";
      }

      // Le bouton suit la variante choisie : masqué si elle n'a pas de modèle.
      function refresh() {
        var ok = Boolean(currentTemplate());
        link.hidden = !ok;
        if (ok && status.dataset.kind === "variante") { say(""); status.dataset.kind = ""; }
        if (!ok) { say("Cette variante n'est pas personnalisable."); status.dataset.kind = "variante"; }
      }
      // Le thème met la variante à jour après le changement d'option, parfois
      // après un aller-retour au serveur : on relit un peu plus tard.
      function later() {
        setTimeout(refresh, 50);
        setTimeout(refresh, 1500);
      }
      document.addEventListener("change", later);
      document.addEventListener("variant:change", later);

      // Aller : le modèle de la variante, la variante et la quantité choisies.
      link.addEventListener("click", function (e) {
        e.preventDefault();
        var template = currentTemplate();
        if (!template) { refresh(); return; }
        var params = new URLSearchParams({
          template: template,
          cle: KEY,
          variant: currentVariant(),
          quantity: currentQuantity(),
          retour: SHOP + location.pathname,
          boutique: BOUTIQUE
        });
        location.href = TOOL + "?" + params.toString();
      });

      // Retour : l'outil renvoie ?pico_design=…&variant=…&quantity=… (un
      // design), ou ?pico_batch=…&variant=… (impression de photos : une ligne
      // de panier par photo, lue chez Pico Design).
      var back = new URLSearchParams(location.search);
      var batch = back.get("pico_batch");
      if (batch && /^[0-9a-f-]{36}$/i.test(batch)) {
        back.delete("pico_batch");
        history.replaceState(null, "", location.pathname + (back.toString() ? "?" + back.toString() : ""));
        var batchKey = "pico_batch_added_" + batch;
        try { if (sessionStorage.getItem(batchKey)) return; } catch (err) {}
        say("Ajout de tes photos au panier…");
        var variantId = Number(back.get("variant") || currentVariant());
        fetch("${SITE}/api/design/batch/" + batch)
          .then(function (res) { return res.json(); })
          .then(function (data) {
            var lines = (data.items || []).map(function (it) {
              return { id: variantId, quantity: Math.max(1, it.quantity || 1), properties: { _design: it.design } };
            });
            if (!lines.length) throw new Error("aucune photo trouvée");
            // Par paquets : un très gros lot en une seule requête serait refusé.
            var chain = Promise.resolve();
            for (var i = 0; i < lines.length; i += 40) {
              (function (chunk) {
                chain = chain.then(function () {
                  return fetch(CART_ADD, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Accept: "application/json" },
                    body: JSON.stringify({ items: chunk })
                  }).then(function (res) {
                    if (!res.ok) return res.json().then(function (d) { throw new Error(d.description || d.message); });
                  });
                });
              })(lines.slice(i, i + 40));
            }
            return chain;
          })
          .then(function () {
            try { sessionStorage.setItem(batchKey, "1"); } catch (err) {}
            location.href = CART;
          })
          .catch(function (err) {
            say("Tes photos n'ont pas pu être ajoutées au panier" + (err && err.message ? " : " + err.message : "") + ". Réessaie ou contacte-nous.");
          });
        return;
      }
      var design = back.get("pico_design");
      if (!design || !/^[0-9a-f-]{36}$/i.test(design)) { refresh(); return; }

      // pico_design retiré de l'adresse : recharger n'ajoute pas deux fois.
      back.delete("pico_design");
      var clean = location.pathname + (back.toString() ? "?" + back.toString() : "");
      history.replaceState(null, "", clean);

      var doneKey = "pico_design_added_" + design;
      try {
        if (sessionStorage.getItem(doneKey)) return;
      } catch (err) {}

      say("Ajout de ton design au panier…");
      fetch(CART_ADD, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          items: [{
            id: Number(back.get("variant") || currentVariant()),
            quantity: Math.max(1, parseInt(back.get("quantity"), 10) || 1),
            properties: { _design: design }
          }]
        })
      })
        .then(function (res) {
          if (!res.ok) return res.json().then(function (data) { throw new Error(data.description || data.message); });
          try { sessionStorage.setItem(doneKey, "1"); } catch (err) {}
          location.href = CART;
        })
        .catch(function (err) {
          say("Ton design n'a pas pu être ajouté au panier" + (err && err.message ? " : " + err.message : "") + ". Réessaie ou contacte-nous.");
        });
    })();
  </script>
{%- endif -%}`;

const READY_PRODUCT_BLOCK = String.raw`{%- comment -%}
  Pico Design : produit déjà fait, vendu tel quel (sans passer par l'outil).
  Ajoute l'id du produit Pico (métachamp custom.pico_product, copié depuis
  Pico Design > Produits) à l'article mis au panier : la commande arrive dans
  Pico Design avec le PDF du produit. Sans id, ce bloc ne fait rien.
{%- endcomment -%}
{%- assign pico_product = product.metafields.custom.pico_product.value -%}
{%- if pico_product != blank -%}
<script>
  (function () {
    var ID = {{ pico_product | json }};
    function apply() {
      document.querySelectorAll('form[action*="/cart/add"]').forEach(function (form) {
        if (form.querySelector('input[name="properties[_pico_product]"]')) return;
        var input = document.createElement("input");
        input.type = "hidden";
        input.name = "properties[_pico_product]";
        input.value = ID;
        form.appendChild(input);
      });
    }
    apply();
    // Certains thèmes recréent le formulaire (changement de variante) : on repasse.
    new MutationObserver(apply).observe(document.body, { childList: true, subtree: true });
  })();
</script>
{%- endif -%}`;

const AURORA_CART_LINES = String.raw`{% assign pico_design = item.properties['_design'] %}
{% if pico_design != blank %}
  <img src='${SITE}/api/design/preview/{{ pico_design }}' alt='Aperçu de ton design' class='cart-item__image shape__target-image' style='object-fit: contain !important'>
{% elsif item.image %}`;

const GENERIC_CART_BLOCK = String.raw`{%- assign pico_design = item.properties['_design'] -%}
{%- if pico_design != blank -%}
  <img
    src="${SITE}/api/design/preview/{{ pico_design | url_encode }}"
    alt="Aperçu de ton design"
    width="150"
    style="object-fit: contain !important"
    loading="lazy"
  >
{%- else -%}
  {%- comment -%} Ici : le code d'origine de l'image du produit {%- endcomment -%}
{%- endif -%}`;

const MEDIACLIP_CART_BLOCK = String.raw`{%- comment -%}
  Pico Design : aperçu du design dans le panier affiché par Mediaclip Hub
  (classes mc-cart-item). Son Liquid n'est pas modifiable : ce bloc remplace
  l'image du produit par l'aperçu, pour chaque article qui porte un design.
{%- endcomment -%}
{%- capture pico_cart_designs -%}{
  {%- for item in cart.items -%}
    {%- assign pico_design = item.properties['_design'] -%}
    {%- if pico_design != blank -%}{{ item.key | json }}: {{ pico_design | json }},{%- endif -%}
  {%- endfor -%}
  "": ""
}{%- endcapture -%}
<script>
  (function () {
    var designs = {{ pico_cart_designs }};
    var PREVIEW = "${SITE}/api/design/preview/";
    function apply() {
      document.querySelectorAll("[data-mc-shopify-cart-item-key]").forEach(function (item) {
        var id = designs[item.getAttribute("data-mc-shopify-cart-item-key")];
        if (!id) return;
        var img = item.querySelector("img");
        if (!img || img.getAttribute("src") === PREVIEW + id) return;
        img.src = PREVIEW + id;
        img.removeAttribute("srcset");
        img.alt = "Aperçu de ton design";
        // Le visuel au complet : la vignette du panier le recadrerait.
        img.style.setProperty("object-fit", "contain", "important");
      });
    }
    apply();
    // Mediaclip réaffiche le panier (quantité, suppression) : on repasse.
    new MutationObserver(apply).observe(document.body, { childList: true, subtree: true });
  })();
</script>`;

const SECTIONS = [
  { id: "avant", title: "Avant de commencer" },
  { id: "modeles", title: "1. Préparer les modèles" },
  { id: "metachamp", title: "2. Créer le métachamp" },
  { id: "produits", title: "3. Relier les produits" },
  { id: "bouton", title: "4. Ajouter le bouton" },
  { id: "panier", title: "5. Aperçu dans le panier" },
  { id: "commandes", title: "6. Recevoir les commandes" },
  { id: "habillage", title: "7. Habillage (facultatif)" },
  { id: "produit-fait", title: "8. Produit déjà fait" },
  { id: "tester", title: "Tester" },
  { id: "depannage", title: "Dépannage" },
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3 rounded-xl border border-border bg-surface p-5">
      <h2 className="font-heading text-lg font-semibold text-text">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-text-muted">{children}</div>
    </section>
  );
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-1.5 pl-5">{children}</ol>;
}

// Nom de fichier, de champ ou de valeur, lisible même une fois copié ailleurs.
function K({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[0.85em] text-text">{children}</code>;
}

export default async function AidePage() {
  await requireUser();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-semibold tracking-widest text-pico-accent">AIDE</p>
        <h1 className="mt-1 font-heading text-page-title font-semibold text-text">
          Intégrer Pico Design à une boutique Shopify
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          Le client clique <strong>Débuter votre création</strong> sur une fiche produit, compose son design dans l&apos;Outil
          Shopify, puis revient avec son article ajouté au panier, aperçu compris. Une fois payée, la commande arrive
          dans <Link href="/orders" className="text-primary underline">Commandes</Link> avec son PDF prêt pour
          l&apos;impression. Compter une trentaine de minutes, plus la saisie des produits.
        </p>
      </div>

      <nav aria-label="Sommaire" className="rounded-xl border border-border bg-surface p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-text-subtle">Sommaire</p>
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-text-muted hover:text-primary hover:underline">
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Section id="avant" title="Avant de commencer">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Un accès administrateur à la boutique Shopify (thème et paramètres) et à Pico Design.</li>
          <li>
            La <strong>clé du lien</strong> (<K>DESIGN_LINK_KEY</K>), rangée dans le gestionnaire de mots de passe.
            Elle est commune à toutes les boutiques ; Vercel ne peut pas la réafficher.
          </li>
          <li>
            Le <strong>domaine Shopify</strong> de la boutique, de la forme <K>nom-boutique.myshopify.com</K>{" "}
            (Shopify : Paramètres → Domaines).
          </li>
          <li>
            Par prudence, une <strong>copie du thème</strong> : Boutique en ligne → Thèmes → ⋯ → Dupliquer.
          </li>
        </ul>
      </Section>

      <Section id="modeles" title="1. Préparer les modèles">
        <p>
          Chaque produit personnalisable correspond à un modèle de la page{" "}
          <Link href="/templates" className="text-primary underline">
            Modèles
          </Link>{" "}
          (dimensions, fond perdu, mockups).
        </p>
        <p>
          Sur la ligne du modèle, le bouton <strong>Copier l&apos;ID pour Shopify</strong> (icône Shopify) copie
          l&apos;identifiant à coller dans Shopify à l&apos;étape 3.
        </p>
      </Section>

      <Section id="metachamp" title="2. Créer le métachamp « Modèle Pico » (une seule fois)">
        <Steps>
          <li>Shopify : Paramètres → Données personnalisées → Produits → Ajouter une définition.</li>
          <li>
            Nom : <K>Modèle Pico</K>
          </li>
          <li>
            Espace de nom et clé : <K>custom.pico_template</K>
          </li>
          <li>
            Type : <strong>Texte sur une ligne</strong>, puis Enregistrer.
          </li>
          <li>
            Si le modèle change selon la variante : refaire la même définition dans Paramètres → Données
            personnalisées → <strong>Variantes</strong>, clé <K>custom.custom_pico_template</K> (ou{" "}
            <K>custom.pico_template</K>), type Texte sur une ligne.
          </li>
        </Steps>
      </Section>

      <Section id="produits" title="3. Relier les produits">
        <p>
          Sur chaque produit personnalisable, coller l&apos;id du modèle (étape 1) dans le champ{" "}
          <strong>Modèle Pico</strong>, en bas de la fiche produit dans Shopify. Un produit sans id n&apos;affiche
          pas le bouton.
        </p>
        <p>
          Modèle différent selon la variante : coller l&apos;id dans le champ <strong>Modèle Pico</strong> de la
          variante (fiche produit → la variante). Une variante sans id reprend celui du produit. Une variante sans
          modèle, ni sur elle ni sur le produit, n&apos;est pas personnalisable : le bouton se masque quand elle est
          choisie.
        </p>
      </Section>

      <Section id="bouton" title="4. Ajouter le bouton « Débuter votre création »">
        <Steps>
          <li>Boutique en ligne → Thèmes → Personnaliser.</li>
          <li>En haut, choisir le modèle de page Produit.</li>
          <li>
            Ajouter un bloc → <strong>Liquid personnalisé</strong>, à l&apos;endroit où le bouton doit apparaître.
          </li>
          <li>Coller le code ci-dessous.</li>
          <li>
            Dans ce code, remplacer <K>VOTRE_DESIGN_LINK_KEY</K> par la clé du lien, puis Enregistrer.
          </li>
        </Steps>
        <CodeBlock label="Bloc Liquid personnalisé — fiche produit" code={PRODUCT_BLOCK} />
        <p>
          Au retour de l&apos;outil, ce même bloc ajoute l&apos;article au panier (bonne variante, bonne quantité) et
          envoie le client sur la page panier. Pour un modèle en <strong>Impression de photos</strong> (réglage du
          modèle), il ajoute une ligne par photo, avec sa quantité et son aperçu.
        </p>
        <p className="text-xs">
          Bloc collé avant l&apos;arrivée de l&apos;impression de photos ? Recollez-le : l&apos;ancienne version ne sait
          pas ajouter plusieurs photos au panier.
        </p>
      </Section>

      <Section id="panier" title="5. Afficher l'aperçu du design dans le panier">
        <p className="font-medium text-text">Thème Aurora (une seule ligne à remplacer)</p>
        <Steps>
          <li>Boutique en ligne → Thèmes → ⋯ → Modifier le code.</li>
          <li>
            Dossier <strong>Snippets</strong> → fichier <K>cart-item.liquid</K>.
          </li>
          <li>
            Cmd + F (Ctrl + F sur PC) : chercher <K>{"{% if item.image %}"}</K> et prendre la{" "}
            <strong>première</strong> ligne trouvée, juste sous <K>cart-item__image-wrapper</K>.
          </li>
          <li>Effacer cette seule ligne et coller les quatre lignes ci-dessous à sa place.</li>
          <li>Enregistrer. Le reste du bloc (photo, else, endif) ne change pas.</li>
        </Steps>
        <CodeBlock label="cart-item.liquid — remplace la ligne {% if item.image %}" code={AURORA_CART_LINES} />
        <p>Ce fichier sert au tiroir de panier comme à la page panier : les deux sont couverts.</p>

        <p className="pt-2 font-medium text-text">Panier affiché par Mediaclip Hub</p>
        <p>
          Si le panier vient de l&apos;app Mediaclip (ses articles portent la classe <K>mc-cart-item</K>),{" "}
          <K>cart-item.liquid</K> n&apos;est pas utilisé et le Liquid de l&apos;app ne se modifie pas. À la place :
        </p>
        <Steps>
          <li>Boutique en ligne → Thèmes → Personnaliser.</li>
          <li>En haut, choisir la page <strong>Panier</strong>.</li>
          <li>
            Ajouter une section ou un bloc → <strong>Liquid personnalisé</strong>, sous le panier.
          </li>
          <li>Coller le code ci-dessous, puis Enregistrer.</li>
        </Steps>
        <CodeBlock label="Page Panier — bloc Liquid personnalisé (Mediaclip)" code={MEDIACLIP_CART_BLOCK} />

        <p className="pt-2 font-medium text-text">Autre thème</p>
        <p>
          Chercher, dans les fichiers du thème dont le nom contient « cart », la boucle{" "}
          <K>{"for item in cart.items"}</K>, puis l&apos;image du produit juste en dessous (une ligne avec{" "}
          <K>item.image</K>). L&apos;entourer comme ceci :
        </p>
        <CodeBlock label="Autre thème — autour de l'image du produit" code={GENERIC_CART_BLOCK} />
        <p>
          L&apos;aperçu n&apos;apparaît pas dans les pages de paiement : Shopify ne les rend modifiables qu&apos;avec
          Shopify Plus.
        </p>
      </Section>

      <Section id="commandes" title="6. Recevoir les commandes dans Pico Design">
        <p className="font-medium text-text">Dans Shopify : créer deux webhooks</p>
        <Steps>
          <li>Paramètres → Notifications → Webhooks → Créer un webhook.</li>
          <li>
            Événement <strong>Création de commande</strong>, format JSON, URL ci-dessous.
          </li>
          <li>
            Recommencer avec l&apos;événement <strong>Mise à jour de commande</strong>, même URL.
          </li>
          <li>
            Copier la clé affichée en bas de cette page Shopify : « Vos webhooks seront signés avec … ».
          </li>
        </Steps>
        <CodeBlock label="URL du webhook" code={WEBHOOK_URL} />
        <p className="pt-2 font-medium text-text">Dans Pico Design : enregistrer la clé</p>
        <Steps>
          <li>
            <Link href="/settings" className="text-primary underline">
              Paramètres
            </Link>{" "}
            → onglet de la boutique, ou <strong>+ Boutique</strong> avec <K>nom-boutique.myshopify.com</K>.
          </li>
          <li>
            Section <strong>Webhook des commandes</strong> : coller la clé, puis Enregistrer.
          </li>
          <li>
            L&apos;état doit passer à <strong>✓ Secret configuré</strong>.
          </li>
        </Steps>
        <p>La clé n&apos;est jamais réaffichée ; pour la changer, coller la nouvelle. Réservé aux administrateurs.</p>
      </Section>

      <Section id="habillage" title="7. Habillage de la boutique (facultatif)">
        <p>
          Dans{" "}
          <Link href="/settings" className="text-primary underline">
            Paramètres
          </Link>
          , l&apos;onglet de la boutique règle aussi le logo, le favicon, les couleurs et les polices de l&apos;Outil
          Shopify pour ses clients. Sans réglage, l&apos;outil prend l&apos;habillage par défaut.
        </p>
      </Section>

      <Section id="produit-fait" title="8. Vendre un produit déjà fait, sans personnalisation">
        <p>
          Un produit de la page{" "}
          <Link href="/products" className="text-primary underline">
            Produits
          </Link>{" "}
          peut se vendre tel quel : le client l&apos;achète sans passer par l&apos;outil, et la commande arrive dans
          Pico Design avec le PDF du produit.
        </p>
        <Steps>
          <li>
            Shopify : Paramètres → Données personnalisées → Produits → Ajouter une définition. Nom :{" "}
            <K>Produit Pico</K>, espace de nom et clé : <K>custom.pico_product</K>, type{" "}
            <strong>Texte sur une ligne</strong>. Une seule fois.
          </li>
          <li>
            Dans Pico Design → Produits, sur la ligne du produit, le bouton <strong>Copier l&apos;id pour Shopify</strong>{" "}
            (icône Shopify) copie son identifiant.
          </li>
          <li>
            Dans Shopify, le coller dans le champ <strong>Produit Pico</strong> de la fiche produit. Laisser{" "}
            <strong>Modèle Pico</strong> vide : le client ne doit pas personnaliser ce produit.
          </li>
          <li>
            Thèmes → Personnaliser → modèle de page Produit → Ajouter un bloc → <strong>Liquid personnalisé</strong> →
            coller le code ci-dessous, puis Enregistrer. Une seule fois : le bloc ne fait rien sur un produit sans id.
          </li>
        </Steps>
        <CodeBlock label="Bloc Liquid personnalisé — produit déjà fait" code={READY_PRODUCT_BLOCK} />
        <p>
          Les webhooks de commande (étape 6) suffisent : dans Commandes, la ligne propose le PDF du produit.
        </p>
      </Section>

      <Section id="tester" title="Tester avant d'ouvrir aux clients">
        <p>
          Dans une <strong>fenêtre de navigation privée</strong>, sans être connecté à Pico Design :
        </p>
        <Steps>
          <li>
            Ouvrir une fiche produit : le bouton <strong>Débuter votre création</strong> apparaît.
          </li>
          <li>Cliquer : l&apos;éditeur s&apos;ouvre directement sur le bon modèle.</li>
          <li>
            Composer un design, puis <strong>Vérifier et commander</strong> → <strong>Ajouter au panier</strong>.
          </li>
          <li>De retour sur la boutique : l&apos;article est dans le panier, avec l&apos;aperçu du design.</li>
          <li>
            Passer une commande test : elle apparaît dans{" "}
            <Link href="/orders" className="text-primary underline">
              Commandes
            </Link>
            , avec le bouton PDF.
          </li>
        </Steps>
      </Section>

      <Section id="depannage" title="Dépannage">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-text-subtle">
              <tr className="border-b border-border">
                <th className="py-2 pr-4 font-semibold">Ce qu&apos;on voit</th>
                <th className="py-2 font-semibold">Cause probable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                ["Pas de bouton sur la fiche", "Le champ « Modèle Pico » du produit est vide."],
                ["Page de connexion au lieu de l'éditeur", "La clé (KEY) du bloc ne correspond pas à DESIGN_LINK_KEY."],
                ["« Modèle introuvable »", "L'id du champ « Modèle Pico » ne correspond à aucun modèle."],
                [
                  "Galerie des modèles au lieu de l'éditeur",
                  "Lien ouvert en étant connecté à Pico Design : refaire le test en navigation privée.",
                ],
                [
                  "Pas d'« Ajouter au panier » dans l'outil",
                  "Le lien n'a pas transmis la variante ou l'adresse de retour : vérifier le bloc de l'étape 4.",
                ],
                [
                  "L'article n'arrive pas dans le panier",
                  "Le message sous le bouton donne la raison (rupture de stock, variante indisponible…).",
                ],
                ["Panier sans aperçu", "L'étape 5 n'est pas en place pour ce thème."],
                [
                  "La commande n'arrive pas dans Pico Design",
                  "Webhook absent, ou clé de la boutique non enregistrée dans Paramètres (étape 6).",
                ],
              ].map(([seen, cause]) => (
                <tr key={seen}>
                  <td className="py-2 pr-4 align-top text-text">{seen}</td>
                  <td className="py-2 align-top">{cause}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          La clé du lien est visible dans le code de la fiche produit : c&apos;est voulu, elle n&apos;ouvre que
          l&apos;outil sur un modèle dont on connaît l&apos;id, jamais l&apos;administration. Pour la changer, la
          remplacer dans Vercel et dans le bloc de chaque boutique.
        </p>
      </Section>
    </div>
  );
}
