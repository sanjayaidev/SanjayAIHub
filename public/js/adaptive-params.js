// public/js/adaptive-params.js
//
// Renders a model's parameter panel purely from its schema object — the
// same `schemas`/`parameters` object every module's getModelCatalog()
// already returns from GET /api/modules/:moduleKey/models.
//
// Only three control types are ever rendered: <select>, <input type=range>,
// and a toggle (checkbox). There is no free-text number input anywhere in
// this renderer — if a schema field has an unrecognized `type`, it is
// skipped rather than falling back to a text box.
//
// Schema field shape:
//   {
//     type: 'select' | 'range' | 'checkbox',
//     label?: string,
//     default: any,
//     options?: (string|number|{value, label})[],   // select only
//     min?, max?, step?: number,                     // range only
//     dependsOn?: string,                             // name of a checkbox
//                                                      // field that gates
//                                                      // whether this field
//                                                      // is active/sent
//   }
//
// Usage:
//   const panel = AdaptiveParams.mount(containerEl, schema, {
//     onChange: (values) => { ... }
//   });
//   // later, read the current values right before submit:
//   const values = panel.getValues();
//   // when the selected model changes, swap the whole schema in place:
//   panel.setSchema(newSchema);

window.AdaptiveParams = (function () {
  let styleInjected = false;

  function injectStyle() {
    if (styleInjected) return;
    styleInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .ap-panel { display: flex; flex-direction: column; gap: 14px; }
      .ap-field { transition: opacity .15s; }
      .ap-field.ap-disabled { opacity: 0.4; pointer-events: none; }
      .ap-label {
        display: flex; justify-content: space-between; align-items: center;
        font-size: 11px; text-transform: uppercase; letter-spacing: .5px;
        color: var(--ap-muted, #8896b0); margin-bottom: 6px; font-weight: 600;
      }
      .ap-control.ap-select {
        width: 100%; padding: 8px 10px; border-radius: 8px;
        border: 1px solid var(--ap-border, rgba(255,255,255,0.12));
        background: var(--ap-bg, rgba(255,255,255,0.05));
        color: var(--ap-text, #eef2f9); font-size: 13px; font-family: inherit;
      }
      .ap-control.ap-range { width: 100%; accent-color: var(--ap-accent, #00e8a2); }
      .ap-range-value { font-family: monospace; color: var(--ap-accent, #00e8a2); }
      .ap-toggle-row { display: flex; align-items: center; justify-content: space-between; }
      .ap-toggle { position: relative; width: 38px; height: 22px; flex-shrink: 0; display: inline-block; }
      .ap-toggle input { opacity: 0; width: 0; height: 0; }
      .ap-toggle .ap-slider {
        position: absolute; inset: 0; background: var(--ap-border, rgba(255,255,255,0.15));
        border-radius: 22px; transition: .15s; cursor: pointer;
      }
      .ap-toggle .ap-slider::before {
        content: ''; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px;
        background: #fff; border-radius: 50%; transition: .15s;
      }
      .ap-toggle input:checked + .ap-slider { background: var(--ap-accent, #00e8a2); }
      .ap-toggle input:checked + .ap-slider::before { transform: translateX(16px); }
      .ap-empty { color: var(--ap-muted, #8896b0); font-size: 12px; padding: 6px 0; }
    `;
    document.head.appendChild(style);
  }

  function labelFor(key, def) {
    return def.label || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function mount(container, initialSchema, opts) {
    injectStyle();
    opts = opts || {};

    let schema = {};
    let state = {};
    let fieldEls = {};

    function updateDependents() {
      Object.keys(schema).forEach((key) => {
        const def = schema[key];
        if (!def.dependsOn) return;
        const wrap = fieldEls[key] && fieldEls[key].wrap;
        if (!wrap) return;
        wrap.classList.toggle('ap-disabled', !state[def.dependsOn]);
      });
    }

    function getValues() {
      const out = {};
      Object.keys(schema).forEach((key) => {
        const def = schema[key];
        if (def.dependsOn && !state[def.dependsOn]) return; // gated off — omit entirely
        out[key] = state[key];
      });
      return out;
    }

    function emitChange() {
      updateDependents();
      if (opts.onChange) opts.onChange(getValues());
    }

    function buildField(key, def) {
      const wrap = document.createElement('div');
      wrap.className = 'ap-field';

      if (def.type === 'checkbox') {
        const row = document.createElement('div');
        row.className = 'ap-toggle-row';
        const lbl = document.createElement('span');
        lbl.className = 'ap-label';
        lbl.textContent = labelFor(key, def);
        const toggle = document.createElement('label');
        toggle.className = 'ap-toggle';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!def.default;
        const slider = document.createElement('span');
        slider.className = 'ap-slider';
        toggle.appendChild(input);
        toggle.appendChild(slider);
        row.appendChild(lbl);
        row.appendChild(toggle);
        wrap.appendChild(row);
        input.addEventListener('change', () => {
          state[key] = input.checked;
          emitChange();
        });
        fieldEls[key] = { wrap, input };
        return wrap;
      }

      if (def.type === 'select') {
        const lbl = document.createElement('label');
        lbl.className = 'ap-label';
        lbl.textContent = labelFor(key, def);
        const select = document.createElement('select');
        select.className = 'ap-control ap-select';
        (def.options || []).forEach((opt) => {
          const isObj = opt && typeof opt === 'object';
          const value = isObj ? opt.value : opt;
          const text = isObj ? opt.label : String(opt);
          const o = document.createElement('option');
          o.value = value;
          o.textContent = text;
          if (value === def.default) o.selected = true;
          select.appendChild(o);
        });
        wrap.appendChild(lbl);
        wrap.appendChild(select);
        select.addEventListener('change', () => {
          state[key] = select.value;
          emitChange();
        });
        fieldEls[key] = { wrap, input: select };
        return wrap;
      }

      if (def.type === 'range') {
        const lbl = document.createElement('label');
        lbl.className = 'ap-label';
        const nameSpan = document.createElement('span');
        nameSpan.textContent = labelFor(key, def);
        const valueSpan = document.createElement('span');
        valueSpan.className = 'ap-range-value';
        valueSpan.textContent = def.default;
        lbl.appendChild(nameSpan);
        lbl.appendChild(valueSpan);
        const input = document.createElement('input');
        input.type = 'range';
        input.className = 'ap-control ap-range';
        input.min = def.min;
        input.max = def.max;
        input.step = def.step || 1;
        input.value = def.default;
        wrap.appendChild(lbl);
        wrap.appendChild(input);
        input.addEventListener('input', () => {
          const isFloat = def.step && def.step < 1;
          state[key] = isFloat ? parseFloat(input.value) : parseInt(input.value, 10);
          valueSpan.textContent = input.value;
          emitChange();
        });
        fieldEls[key] = { wrap, input };
        return wrap;
      }

      // Unknown/unsupported type: never fall back to a free-text input.
      return null;
    }

    function setSchema(newSchema) {
      schema = newSchema || {};
      state = {};
      fieldEls = {};
      container.innerHTML = '';
      container.classList.add('ap-panel');

      const keys = Object.keys(schema);
      if (keys.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'ap-empty';
        empty.textContent = 'This model has no adjustable parameters.';
        container.appendChild(empty);
        if (opts.onChange) opts.onChange({});
        return;
      }

      keys.forEach((key) => {
        state[key] = schema[key].default;
      });

      keys.forEach((key) => {
        const el = buildField(key, schema[key]);
        if (el) container.appendChild(el);
      });

      updateDependents();
      if (opts.onChange) opts.onChange(getValues());
    }

    // Programmatically set a single field's value after mount (e.g. to
    // pre-fill width/height once the source video's real resolution is
    // known). Updates both internal state and the rendered control so
    // getValues() and the UI stay in sync. No-op for unknown fields.
    function setValue(key, value) {
      if (!(key in schema)) return;
      const def = schema[key];
      const fe = fieldEls[key];

      state[key] = (def.type === 'range' && def.step && def.step < 1)
        ? parseFloat(value)
        : (def.type === 'range' ? parseInt(value, 10) : value);

      if (fe && fe.input) {
        fe.input.value = value;
        if (def.type === 'range') {
          const valueSpan = fe.wrap.querySelector('.ap-range-value');
          if (valueSpan) valueSpan.textContent = value;
        }
      }

      emitChange();
    }

    setSchema(initialSchema);

    return { getValues, setSchema, setValue, container };
  }

  return { mount };
})();
