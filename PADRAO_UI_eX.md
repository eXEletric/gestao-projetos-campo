# Padrão de UI — eX (componentes reutilizáveis)

Componentes visuais padronizados para **todos os apps do projeto eX** (eX_Cronograma.html, manual_cartao.html, etc.). Ao criar um novo controle equivalente, **use estes** em vez de inventar outro.

---

## 1. Chave manual (liga/desliga) + Sinaleira LED

Padrão ratificado pelo dono (05/07/2026) para o eX (empresa de automação/elétrica). Usar em **qualquer estado booleano**: permissões, ativo/inativo, liga/desliga de opções.

- **Chave (`.ex-switch`)**: estilo de chave manual industrial, estreita, com miolo **ON/OFF** dentro, contorno arredondado e **pino 3D** (cara de chave física). Verde quando ligada, cinza quando desligada.
- **Sinaleira (`.ex-led`)**: LED de quadro elétrico. **Apagada = branco quase gelo** (discreta); **acesa = verde intenso brilhando**. Sem ícone dentro (mantido pequeno/discreto).
- Clicar alterna; o estado é a classe `.on` em ambos.

### CSS (colar no `<style>` do app)
```css
.ex-led{width:15px;height:15px;border-radius:50%;flex-shrink:0;transition:.16s;background:radial-gradient(circle at 35% 30%,#ffffff,#eef1ef 72%);box-shadow:inset 0 1px 1px rgba(0,0,0,.12),0 1px 0 rgba(255,255,255,.6);border:1.5px solid #d9dcd9}
.ex-led.on{background:radial-gradient(circle at 35% 30%,#c4ffdd,#22d27f 52%,#08a457);box-shadow:inset 0 1px 2px rgba(255,255,255,.6),0 0 8px rgba(34,210,127,.85),0 0 2px rgba(34,210,127,.95);border-color:#08a457}
.ex-switch{position:relative;width:50px;height:25px;border-radius:13px;cursor:pointer;flex-shrink:0;background:linear-gradient(#bbbeb7,#9a9d95);box-shadow:inset 0 2px 4px rgba(0,0,0,.38),inset 0 -1px 1px rgba(255,255,255,.35);transition:.16s;font:800 8px ui-monospace,monospace;letter-spacing:.3px}
.ex-switch.on{background:linear-gradient(#2fcf88,#0f8f5b);box-shadow:inset 0 2px 4px rgba(0,0,0,.3)}
.ex-switch .lb{position:absolute;top:0;height:100%;display:flex;align-items:center;color:#fff}
.ex-switch .lb.off{right:8px;color:#5a5a50}.ex-switch.on .lb.off{display:none}
.ex-switch .lb.onx{left:8px;display:none}.ex-switch.on .lb.onx{display:flex}
.ex-switch .kb{position:absolute;top:3px;left:3px;width:20px;height:19px;border-radius:10px;transition:.16s;background:linear-gradient(#ffffff,#d4d4cf);box-shadow:0 2px 2px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.95),inset 0 -1px 2px rgba(0,0,0,.1);display:flex;align-items:center;justify-content:center}
.ex-switch.on .kb{left:27px}
.ex-switch .pin{width:3px;height:11px;border-radius:2px;background:linear-gradient(#9a9a92,#565650);box-shadow:0 1px 1px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.5)}
```

### HTML de uso
```html
<!-- linha típica: sinaleira + rótulo + chave -->
<div style="display:flex;align-items:center;gap:11px">
  <span class="ex-led on"></span>              <!-- .on = aceso -->
  <span style="flex:1">Nome do item</span>
  <div class="ex-switch on" onclick="alternar(id)"> <!-- .on = ligado -->
    <span class="lb off">OFF</span><span class="lb onx">ON</span>
    <span class="kb"><span class="pin"></span></span>
  </div>
</div>
```

### JS (padrão)
No clique, alterne o estado no modelo e re-renderize (adicionando/removendo `.on` na chave E na sinaleira). Ex. de referência: `renderGrupoChips`/`toggleGrupoChip` em `manual_cartao.html` (seleção de "quais grupos podem usar" a etiqueta).

**Primeiro uso:** seleção de grupos no editor de etiqueta do [[Manual do Cartão]] (manual_cartao.html).
