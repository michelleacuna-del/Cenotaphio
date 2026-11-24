/* Memento — prototipo.
   Este archivo no tiene textos: todo lo que se lee en la página está en index.html
   (las páginas, el bloque "TEXTOS QUE APARECEN" y los "PERFILES DE EJEMPLO").
   Aquí solo se muestra la vista según la URL, se rellenan las plantillas y se maneja la interacción. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const clon = id => $('#' + id).content.firstElementChild.cloneNode(true);
const leer = k => { try { return localStorage.getItem(k); } catch { return null; } };
const escribir = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
const configSupabase = window.MEMENTO_SUPABASE_CONFIG;
const clienteSupabase = configSupabase?.url && configSupabase?.anonKey && window.supabase
  ? window.supabase.createClient(configSupabase.url, configSupabase.anonKey)
  : null;

// ---------- Textos (vienen del bloque #textos del HTML) ----------
const texto = (clave, datos = {}) =>
  ($(`#textos [data-texto="${clave}"]`)?.textContent.trim() ?? clave).replace(/\{(\w+)\}/g, (_, k) => datos[k] ?? '');
const cuenta = (n, clave) => texto(`${clave}-${n === 1 ? 'uno' : 'varios'}`, { n });
const tituloBase = document.title;

// ---------- Datos (los ejemplos vienen del bloque #ejemplos del HTML) ----------
const limpio = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const dato = (el, nombre) => limpio($(`:scope > [data-dato="${nombre}"]`, el));
const ejemplos = $('#ejemplos').content;
// Si alguien edita los ejemplos en el HTML, la firma cambia y se vuelven a cargar.
const firma = [...$('#ejemplos').innerHTML].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);

function semilla() {
  const perfiles = $$('article', ejemplos).map(a => ({
    id: a.dataset.codigo, hue: +a.dataset.tono || 30, foto: a.dataset.foto || '',
    puntoCielo: a.dataset.cieloX && a.dataset.cieloY
      ? { x: +a.dataset.cieloX, y: +a.dataset.cieloY } : null,
    nombre: dato(a, 'nombre'), relacion: dato(a, 'relacion'), nacimiento: dato(a, 'nacimiento'),
    partida: dato(a, 'partida'), frase: dato(a, 'frase'), bio: dato(a, 'bio'),
    objetos: $$('.recuerdo', a).map(r => ({
      id: r.dataset.codigo, tipo: r.dataset.tipo, x: +r.dataset.x || 50, y: +r.dataset.y || 50, foto: r.dataset.foto || '',
      nombre: dato(r, 'nombre'), fecha: dato(r, 'fecha'), lugar: dato(r, 'lugar'), descripcion: dato(r, 'descripcion'),
      historia: $$('[data-dato=historia] p', r).map(limpio).join('\n\n')
    })),
    conexiones: $$('.hilo', a).map((h, i) => {
      const [uno, otro] = h.dataset.une.trim().split(/\s+/);
      return { id: `${a.dataset.codigo}-${i}`, a: uno, b: otro, nota: limpio(h) };
    })
  }));
  return { firma, perfiles };
}

const referencias = semilla().perfiles.map(p => ({ ...p, soloLectura: true }));
let estado = null, usuarioActual = null, errorRespaldo = false, authLista = false, errorCarga = '';
let colaRespaldo = Promise.resolve();

let actual = {};

const perfilesVisibles = () => estado?.perfiles || [];
const perfilValido = p => p && typeof p.id === 'string' && typeof p.nombre === 'string'
  && Array.isArray(p.objetos) && p.objetos.every(o => o && typeof o.id === 'string')
  && Array.isArray(p.conexiones) && p.conexiones.every(c => c && typeof c.a === 'string' && typeof c.b === 'string');
let altaresPublicos = [], altaresPublicosListos = false, altaresPublicosPromesa, altarEnColocacion = null, altarSeleccionado = null;

function guardar() {
  if (!estado || !usuarioActual || !clienteSupabase) return;
  const userId = usuarioActual.id;
  const respaldo = { version: 1, perfiles: JSON.parse(JSON.stringify(estado.perfiles)) };
  $('#estado-respaldo').textContent = 'Guardando respaldo…';
  errorRespaldo = false;
  colaRespaldo = colaRespaldo.then(async () => {
    if (usuarioActual?.id !== userId) return;
    const { error } = await clienteSupabase.from('user_backups').upsert({
      user_id: userId, payload: respaldo, updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) throw error;
    if (usuarioActual?.id === userId) {
      errorRespaldo = false;
      $('#estado-respaldo').textContent = 'Respaldo actualizado.';
      $('#reintentar-respaldo').hidden = true;
    }
  }).catch(error => {
    console.error('No se pudo guardar el respaldo de la cuenta.', error);
    if (usuarioActual?.id === userId) {
      errorRespaldo = true;
      $('#estado-respaldo').textContent = 'No se pudo actualizar el respaldo. Revisa tu conexión e inténtalo de nuevo.';
      $('#reintentar-respaldo').hidden = false;
      aviso('No se pudo actualizar el respaldo.');
    }
  });
  return colaRespaldo;
}

const importacionesLocales = new Set();
function perfilesLegado() {
  const valor = leer('memento.v1');
  if (!valor) return [];
  try {
    const legado = JSON.parse(valor);
    if (!Array.isArray(legado.perfiles) || legado.perfiles.some(p => !perfilValido(p))) {
      throw new Error('Los datos locales no tienen el formato esperado.');
    }
    return legado.perfiles;
  } catch (error) {
    console.error('No se pudieron leer los datos anteriores de este navegador.', error);
    return [];
  }
}

function actualizarImportacionLocal() {
  const importacionId = `memento.importado.${usuarioActual?.id}`;
  const yaImportado = importacionesLocales.has(importacionId) || leer(importacionId) === 'si';
  $('#importar-datos-locales').hidden = yaImportado || perfilesLegado().length === 0;
}

async function importarDatosLocales() {
  if (!estado || !usuarioActual) return;
  const perfiles = perfilesLegado();
  if (!perfiles.length) {
    $('#importar-datos-locales').hidden = true;
    return;
  }
  const confirmado = window.confirm(
    `Se copiarán ${perfiles.length} altares guardados en este navegador a la cuenta ${usuarioActual.email}. `
    + 'La copia puede incluir los perfiles de ejemplo guardados localmente. Los datos locales no se borrarán. ¿Continuar?'
  );
  if (!confirmado) return;

  const boton = $('#importar-datos-locales');
  const userId = usuarioActual.id;
  const estadoCuenta = estado;
  const anteriores = estado.perfiles;
  boton.disabled = true;
  $('#cerrar-sesion').disabled = true;
  try {
    const copias = perfiles.map(perfil => {
      const copia = JSON.parse(JSON.stringify(perfil));
      const idsObjetos = new Map(copia.objetos.map(objeto => [objeto.id, uid()]));
      copia.id = uid();
      copia.objetos.forEach(objeto => { objeto.id = idsObjetos.get(objeto.id); });
      copia.conexiones = copia.conexiones
        .filter(conexion => idsObjetos.has(conexion.a) && idsObjetos.has(conexion.b))
        .map(conexion => ({
          ...conexion, id: uid(), a: idsObjetos.get(conexion.a), b: idsObjetos.get(conexion.b)
        }));
      delete copia.velas;
      delete copia.soloLectura;
      return copia;
    });
    estado.perfiles = [...anteriores, ...copias];
    render();
    await guardar();
    await colaRespaldo;
    if (estado !== estadoCuenta || usuarioActual?.id !== userId) return;
    if (errorRespaldo) {
      estado.perfiles = anteriores;
      render();
      return;
    }
    const clave = `memento.importado.${userId}`;
    importacionesLocales.add(clave);
    if (!escribir(clave, 'si')) {
      $('#estado-respaldo').textContent = 'Importación respaldada. No pudimos registrar en este navegador que ya se importó; evita repetirla.';
    }
    actualizarImportacionLocal();
    aviso('Los altares anteriores ya están respaldados en esta cuenta.');
  } catch (error) {
    if (estado === estadoCuenta) {
      estado.perfiles = anteriores;
      render();
    }
    console.error('No se pudieron importar los datos anteriores.', error);
    aviso('No se pudieron importar los datos anteriores.');
  } finally {
    boton.disabled = false;
    $('#cerrar-sesion').disabled = false;
  }
}

const fecha = v => {
  const [a, m, d] = (v || '').split('-');
  return d ? new Date(a, m - 1, d).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' }) : v || '';
};
function coordenada(valor, limite) {
  if (valor === '' || valor === null || valor === undefined) return null;
  const numero = Number(valor);
  return Number.isFinite(numero) && Math.abs(numero) <= limite ? numero : null;
}
const anio = v => (v || '').slice(0, 4);
const rango = (p, formato) => {
  const a = formato(p.nacimiento), b = formato(p.partida);
  return a && b && a !== b ? texto('rango', { desde: a, hasta: b }) : b || a;
};
const ordenados = p => [...p.objetos].sort((a, b) => (a.fecha || '9').localeCompare(b.fecha || '9'));
const rutaObjeto = (p, o) => `#/perfil/${p.id}/objeto/${o.id}`;

// Pone texto en cada [data-campo] del bloque; si queda vacío, lo oculta.
function llenar(raiz, datos) {
  for (const el of $$('[data-campo]', raiz)) {
    if (!(el.dataset.campo in datos)) continue;
    const v = datos[el.dataset.campo] ?? '';
    el.textContent = v;
    el.hidden = v === '';
  }
}
function visual(el, o) {
  const icono = ['zapatito', 'osito', 'mechon', 'pulsera', 'chupete', 'foto', 'ecografia', 'carta', 'dibujo', 'vhs', 'cajita', 'mantita', 'autito', 'flor', 'diente', 'sonajero'].includes(o.tipo)
    ? o.tipo : 'cajita';
  el.innerHTML = o.foto ? '<img alt="">' : `<svg class="icono" viewBox="0 0 64 64"><use href="#i-${icono}"/></svg>`;
  if (o.foto) el.firstChild.src = o.foto;
}
function retrato(el, p) {
  el.innerHTML = p.foto ? '<img alt="">' : '<span class="inicial" aria-hidden="true"></span>';
  el.firstChild[p.foto ? 'src' : 'textContent'] = p.foto || p.nombre.charAt(0);
  if (p.foto) el.firstChild.decoding = 'async';
}

// ---------- Vistas ----------
function render(nueva) {
  const [, v, pid, , oid] = location.hash.split('/');
  const p = perfilesVisibles().find(x => x.id === pid);
  const o = p?.objetos.find(x => x.id === oid);
  const vista = !v || v === 'proyecto' ? 'inicio'
    : v === 'coleccion' || v === 'explorar' || v === 'privacidad' ? v
      : o ? 'objeto' : p && !oid ? 'perfil' : 'nada';
  actual = { p, o };

  $$('[data-vista]').forEach(s => (s.hidden = s.dataset.vista !== vista));
  if (vista === 'coleccion') pintarColeccion();
  if (vista === 'explorar') pintarExplorar();
  if (vista === 'perfil') pintarPerfil();
  if (vista === 'objeto') pintarObjeto();

  document.title = vista === 'privacidad'
    ? `Políticas de privacidad · ${tituloBase}`
    : [o?.nombre || p?.nombre, tituloBase].filter(Boolean).join(' · ');
  const navActual = vista === 'inicio' ? 'inicio' : vista === 'explorar' ? 'explorar'
    : vista === 'coleccion' || vista === 'perfil' || vista === 'objeto' ? 'coleccion' : null;
  $$('[data-nav]').forEach(a => a.dataset.nav === navActual
    ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  if (authLista && vista === 'coleccion' && !usuarioActual && !$('#acceso').open) {
    mostrarAcceso(!clienteSupabase
      ? 'Falta configurar Supabase para entrar a Mi altar. Sigue las instrucciones de mixi-app/SUPABASE.md.'
      : errorCarga);
  }
  if (nueva) {
    if (v !== 'proyecto') scrollTo(0, 0);
    $('#vista').animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
      { duration: 900, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }
  if (v === 'proyecto') {
    setTimeout(() => {
      $('#acerca-del-proyecto').scrollIntoView({ block: 'start', behavior: 'instant' });
    }, 50);
  }
}

function pintarColeccion() {
  const lista = $('#perfiles');
  const nuevo = $('.perfil-tarjeta.nueva', lista);
  const perfiles = perfilesVisibles();
  nuevo.hidden = !usuarioActual;
  nuevo.querySelector('[data-campo="accion"]').textContent = perfiles.length
    ? 'Añadir otro altar' : 'Crear mi primer altar';
  $('#perfiles-vacio').hidden = !usuarioActual || perfiles.length > 0;
  $$('.perfil-tarjeta:not(.nueva)', lista).forEach(n => n.remove());
  lista.prepend(...perfiles.map(p => {
    const n = clon('t-perfil');
    n.href = '#/perfil/' + p.id;
    n.style.setProperty('--h', p.hue);
    n.classList.toggle('referencia', !!p.soloLectura);
    retrato($('.retrato', n), p);
    llenar(n, {
      nombre: p.nombre, anios: fecha(p.partida), frase: p.frase,
      recuerdos: cuenta(p.objetos.length, 'recuerdos'),
      referencia: p.soloLectura ? 'Ejemplo de referencia · solo lectura' : ''
    });
    return n;
  }));
}

function pintarExplorar() {
  if (!altaresPublicosListos && !altaresPublicosPromesa) altaresPublicosPromesa = cargarAltaresPublicos();
  pintarCielo();
}

function altaresLocalesPublicos() {
  return perfilesVisibles().filter(p => !p.soloLectura && !p.privado);
}

function pintarCielo() {
  const cielo = $('#cielo'), estrellas = $('#cielo-estrellas'), selector = $('#altar-explorar');
  const perfiles = perfilesVisibles();
  const perfilesPorId = new Map(perfiles.map(p => [p.id, p]));
  const remotos = altaresPublicos.filter(altar => !perfilesPorId.has(altar.id)
    || !perfilesPorId.get(altar.id).privado);
  const locales = altaresLocalesPublicos().filter(p => puntoCieloValido(p.puntoCielo)).map(p => ({
    id: p.id, nombre: p.nombre, x: p.puntoCielo.x, y: p.puntoCielo.y
  }));
  const idsLocales = new Set(locales.map(altar => altar.id));
  const altares = [
    ...referencias.filter(p => !p.privado && puntoCieloValido(p.puntoCielo)).map(p => ({
      id: p.id, nombre: p.nombre, ...p.puntoCielo, ejemplo: true
    })),
    ...remotos.filter(altar => !idsLocales.has(altar.id)),
    ...locales
  ];
  estrellas.replaceChildren();
  for (const altar of altares) {
    const estrella = document.createElement('button');
    estrella.type = 'button';
    estrella.className = `cielo-estrella${altar.ejemplo ? ' cielo-estrella-ejemplo' : ''}`;
    estrella.style.left = `${altar.x}%`;
    estrella.style.top = `${altar.y}%`;
    estrella.dataset.altar = altar.id;
    estrella.setAttribute('aria-label', `Altar de ${altar.nombre}${altar.ejemplo ? ', ejemplo de referencia' : ''}`);
    estrella.setAttribute('aria-pressed', String(altar.id === altarSeleccionado));
    const nombre = document.createElement('span');
    nombre.className = 'cielo-nombre';
    nombre.textContent = altar.nombre;
    estrella.append(nombre);
    estrellas.append(estrella);
  }
  cielo.setAttribute('aria-label', altares.length
    ? `Cielo estrellado con ${altares.length} altares ubicados. Selecciona una estrella para ver su nombre.`
    : 'Cielo estrellado sin altares ubicados todavía.');
  const seleccionado = altares.find(altar => altar.id === altarSeleccionado);
  if (seleccionado) {
    $('#cielo-seleccion').textContent = seleccionado.ejemplo
      ? `Altar de ${seleccionado.nombre} · ejemplo de referencia.`
      : `Altar de ${seleccionado.nombre} · su ubicación es simbólica y no muestra una dirección.`;
  } else {
    altarSeleccionado = null;
    $('#cielo-seleccion').textContent = altares.length
      ? 'Cada estrella guarda un lugar de memoria.'
      : 'Todavía no hay altares ubicados en este cielo.';
  }

  const publicos = usuarioActual && estado ? altaresLocalesPublicos() : [];
  selector.replaceChildren();
  const opcionInicial = document.createElement('option');
  opcionInicial.value = '';
  opcionInicial.disabled = true;
  opcionInicial.selected = true;
  opcionInicial.textContent = usuarioActual
    ? publicos.length ? 'Elige un altar' : 'No tienes altares públicos'
    : clienteSupabase ? 'Inicia sesión o crea una cuenta para elegir un altar' : 'Exploración pública';
  selector.append(opcionInicial);
  for (const perfil of publicos) {
    const opcion = document.createElement('option');
    opcion.value = perfil.id;
    opcion.textContent = perfil.nombre;
    selector.append(opcion);
  }
  selector.disabled = publicos.length === 0;
  $('#cielo-ubicar').disabled = publicos.length === 0;
  if (!publicos.length && usuarioActual) {
    $('#cielo-mensaje').textContent = 'Para ubicar un altar, primero hazlo público desde Mi altar.';
  }
  if (altares.length === 0) {
    $('#cielo-seleccion').textContent = 'Todavía no hay altares ubicados en este cielo.';
  }
}

function puntoCieloValido(punto) {
  return punto && coordenada(punto.x, 100) !== null && coordenada(punto.y, 100) !== null;
}

function actualizarPreviaCielo() {
  const estrellas = $('#cielo-estrellas');
  let previa = $('.cielo-previa', estrellas);
  if (!previa) {
    previa = document.createElement('span');
    previa.className = 'cielo-previa';
    previa.setAttribute('aria-hidden', 'true');
    estrellas.append(previa);
  }
  previa.style.left = `${$('#cielo-x').value}%`;
  previa.style.top = `${$('#cielo-y').value}%`;
}

function iniciarUbicacion() {
  const perfil = perfilesVisibles().find(p => p.id === $('#altar-explorar').value);
  if (!perfil || perfil.privado || perfil.soloLectura) return;
  altarEnColocacion = perfil.id;
  const punto = puntoCieloValido(perfil.puntoCielo) ? perfil.puntoCielo : { x: 50, y: 50 };
  $('#cielo-x').value = punto.x;
  $('#cielo-y').value = punto.y;
  $('#cielo').classList.add('ubicando');
  $('#cielo-coordenadas').hidden = false;
  $('#cielo-ayuda').textContent = 'Toca un punto dentro de la imagen o ajusta la posición con los controles y guárdala.';
  $('#cielo-mensaje').textContent = `Elige un punto para el altar de ${perfil.nombre}.`;
  actualizarPreviaCielo();
}

function guardarPuntoCielo(x, y) {
  const perfil = perfilesVisibles().find(p => p.id === altarEnColocacion);
  if (!perfil || perfil.privado || perfil.soloLectura) {
    altarEnColocacion = null;
    $('#cielo').classList.remove('ubicando');
    $('#cielo-coordenadas').hidden = true;
    $('.cielo-previa', $('#cielo-estrellas'))?.remove();
    pintarCielo();
    return;
  }
  perfil.puntoCielo = { x: +x.toFixed(1), y: +y.toFixed(1) };
  const nombre = perfil.nombre;
  altarSeleccionado = perfil.id;
  altarEnColocacion = null;
  $('#cielo').classList.remove('ubicando');
  $('#cielo-coordenadas').hidden = true;
  $('.cielo-previa', $('#cielo-estrellas'))?.remove();
  $('#cielo-mensaje').textContent = 'El punto es simbólico; no muestra una dirección.';
  guardar();
  pintarCielo();
  $('#cielo-seleccion').textContent = `El altar de ${nombre} ya tiene un lugar en este cielo.`;
  aviso('El altar quedó ubicado en el cielo.');
}

$('#cielo').addEventListener('click', e => {
  const estrella = e.target.closest('.cielo-estrella');
  if (estrella) {
    const altar = estrella.dataset.altar;
    altarSeleccionado = altar;
    $$('.cielo-estrella', $('#cielo')).forEach(el => el.setAttribute('aria-pressed', String(el === estrella)));
    const perfil = referencias.find(p => p.id === altar);
    const local = perfilesVisibles().find(p => p.id === altar);
    const publico = altaresPublicos.find(p => p.id === altar);
    const nombre = perfil?.nombre || local?.nombre || publico?.nombre || 'este altar';
    $('#cielo-seleccion').textContent = perfil
      ? `Altar de ${nombre} · ejemplo de referencia.`
      : `Altar de ${nombre} · su ubicación es simbólica y no muestra una dirección.`;
    if (altarEnColocacion) $('#cielo-mensaje').textContent = 'Toca un punto dentro de la imagen para ubicar el altar que elegiste.';
    return;
  }
  if (!altarEnColocacion) return;
  const areaEstrellas = $('#cielo-estrellas');
  if (!areaEstrellas.contains(e.target)) return;
  const rect = areaEstrellas.getBoundingClientRect();
  const x = Math.max(4, Math.min(96, ((e.clientX - rect.left) / rect.width) * 100));
  const y = Math.max(8, Math.min(92, ((e.clientY - rect.top) / rect.height) * 100));
  guardarPuntoCielo(x, y);
});
$('#altar-explorar').addEventListener('change', () => {
  altarEnColocacion = null;
  $('#cielo').classList.remove('ubicando');
  $('#cielo-coordenadas').hidden = true;
  $('.cielo-previa', $('#cielo-estrellas'))?.remove();
  $('#cielo-mensaje').textContent = '';
});
$('#cielo-ubicar').addEventListener('click', iniciarUbicacion);
$('#cielo-x').addEventListener('input', actualizarPreviaCielo);
$('#cielo-y').addEventListener('input', actualizarPreviaCielo);
$('#cielo-guardar-punto').addEventListener('click', () => {
  guardarPuntoCielo(Number($('#cielo-x').value), Number($('#cielo-y').value));
});
async function cargarAltaresPublicos() {
  const ejemplos = !clienteSupabase;
  try {
    if (clienteSupabase) {
      const { data, error } = await clienteSupabase.rpc('get_public_altars');
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('El servicio devolvió un formato de altares no válido.');
      altaresPublicos = data.filter(altar => altar && typeof altar.id === 'string'
        && typeof altar.nombre === 'string' && typeof altar.x === 'number' && typeof altar.y === 'number'
        && puntoCieloValido({ x: altar.x, y: altar.y }));
      $('#cielo-mensaje').textContent = altaresPublicos.length
        ? 'Aquí aparecen los altares públicos que ya eligieron su punto.'
        : 'Aún no hay altares públicos ubicados; puedes ser la primera persona en elegir un punto.';
    } else {
      $('#cielo-mensaje').textContent = 'Estás viendo altares de ejemplo. Puedes explorar sin iniciar sesión.';
    }
  } catch (error) {
    console.error('No se pudieron cargar los altares públicos para Explorar.', error);
    $('#cielo-mensaje').textContent = 'No se pudieron cargar todos los altares públicos. Mostramos los ejemplos disponibles.';
  }
  altaresPublicosListos = true;
  pintarCielo();
  if (!ejemplos && altaresPublicos.length === 0) {
    $('#cielo-seleccion').textContent = 'Todavía no hay altares ubicados en este cielo.';
  }
}

function pintarPerfil() {
  const { p } = actual, sec = $('[data-vista=perfil]'), hay = p.objetos.length;
  sec.style.setProperty('--h', p.hue);
  retrato($('.retrato', sec), p);
  llenar(sec, { nombre: p.nombre, relacion: p.relacion || texto('relacion-vacia'), fechas: rango(p, fecha) || texto('fechas-vacias'), frase: p.frase, bio: p.bio });
  $('#perfil-referencia').hidden = !p.soloLectura;
  $('.perfil-cabecera .acciones', sec).hidden = !!p.soloLectura;
  $('.archivo-barra .herramientas', sec).hidden = !!p.soloLectura;
  $('#vacio [data-accion="nuevo-objeto"]').hidden = !!p.soloLectura;
  $('#vacio').hidden = hay > 0;

  const vit = $('#vitrina');
  vit.hidden = !hay;
  vit.replaceChildren(...ordenados(p).map(o => {
    const n = clon('t-pieza');
    n.href = rutaObjeto(p, o);
    visual($('.pieza-visual', n), o);
    llenar(n, { nombre: o.nombre, fecha: fecha(o.fecha) || texto('sin-fecha') });
    return n;
  }));
}

function pintarObjeto() {
  const { p, o } = actual, sec = $('[data-vista=objeto]'), lista = ordenados(p), i = lista.indexOf(o), n = lista.length;
  const tipo = nombreTipo(o.tipo);
  llenar(sec, {
    nombre: o.nombre, perfil: p.nombre, tipo: tipo === o.nombre ? '' : tipo || texto('tipo-desconocido'),
    separadorTipo: tipo && tipo !== o.nombre ? ' · ' : '',
    fecha: fecha(o.fecha) || texto('sin-fecha'), lugar: o.lugar || texto('sin-lugar'), descripcion: o.descripcion,
    historia: o.historia || texto('sin-historia'), posicion: texto('posicion', { n: i + 1, total: n })
  });
  $('#enlace-perfil').href = '#/perfil/' + p.id;
  visual($('#pedestal'), o);
  $('#pedestal').classList.toggle('con-foto', !!o.foto);
  $('.objeto-nav', sec).hidden = n < 2;
  $('#anterior').href = rutaObjeto(p, lista[(i - 1 + n) % n]);
  $('#siguiente').href = rutaObjeto(p, lista[(i + 1) % n]);
  $('#foto-texto').textContent = texto(o.foto ? 'foto-cambiar' : 'foto-subir');
  $('.objeto-texto .acciones', sec).hidden = !!p.soloLectura;

  const uniones = p.conexiones.filter(c => c.a === o.id || c.b === o.id).map(c => {
    const otro = p.objetos.find(x => x.id === (c.a === o.id ? c.b : c.a)), el = clon('t-union');
    el.href = rutaObjeto(p, otro);
    visual($('.union-visual', el), otro);
    llenar(el, { nombre: otro.nombre, nota: c.nota });
    return el;
  });
  $('#uniones').replaceChildren(...uniones);
  $('#sin-uniones').hidden = uniones.length > 0;
  if (!uniones.length) $('#sin-uniones').textContent = p.soloLectura
    ? 'Este ejemplo de referencia es de solo lectura.'
    : 'Aún no está unido a otros recuerdos.';
}

const tiposLegado = {
  zapatito: 'Zapatito', osito: 'Peluche', mechon: 'Mechón de pelo', pulsera: 'Pulsera',
  chupete: 'Chupete', foto: 'Fotografía', ecografia: 'Ecografía', carta: 'Carta',
  dibujo: 'Dibujo', vhs: 'Cassette', cajita: 'Cajita', mantita: 'Mantita',
  autito: 'Juguete', flor: 'Flor', diente: 'Diente de leche', sonajero: 'Sonajero'
};
function nombreTipo(tipo) {
  return tiposLegado[tipo] || tipo;
}

// ---------- Ventanas ----------
// Rellena el formulario, lo abre y al cerrarse llama a alCerrar(datos, botón que se usó).
function abrir(d, valores, alCerrar) {
  const f = $('form', d);
  f.reset();
  for (const el of f.elements) {
    if (!el.name || el.type === 'file') continue;
    if (el.type === 'radio') el.checked = el.value === valores[el.name];
    else if (el.type === 'checkbox') el.checked = Boolean(valores[el.name]);
    else el.value = valores[el.name] ?? '';
  }
  $$('[type=file]', f).forEach(input => {
    input.dataset.foto = valores.foto || '';
    ajustesFoto.delete(input);
    mostrarArchivo(input);
  });
  d.returnValue = '';
  d.onclose = async () => {
    const datos = Object.fromEntries(new FormData(f));
    for (const el of $$('input[type=checkbox][name]', f)) datos[el.name] = el.checked;
    const inputFoto = $('[type=file][name=foto]', f);
    if (inputFoto && ajustesFoto.has(inputFoto)) datos.foto = ajustesFoto.get(inputFoto);
    else if (datos.foto?.size) datos.foto = await leerFoto(datos.foto);
    else delete datos.foto;
    alCerrar(datos, d.returnValue);
  };
  d.showModal();
}
function mostrarArchivo(input) {
  const previa = input.nextElementSibling;
  previa.replaceChildren();
  if (input.files[0]) {
    previa.textContent = input.files[0].name;
  } else if (input.dataset.foto) {
    previa.append(Object.assign(document.createElement('img'), { src: input.dataset.foto }));
  } else {
    previa.textContent = texto('elegir-imagen');
  }
}
function leerFoto(archivo) {
  return new Promise(listo => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 800 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = img.width * k;
      c.height = img.height * k;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      listo(c.toDataURL('image/jpeg', 0.8));
    };
    img.src = URL.createObjectURL(archivo);
  });
}

const ajustesFoto = new Map();
let editorFotoActual = null;

function ajustarFoto(archivo, retrato, alGuardar, alCancelar) {
  if (!archivo) return;
  const dialogo = $('#d-ajustar-foto');
  const marco = $('#editor-foto');
  const imagen = $('#editor-foto-imagen');
  const zoom = $('#editor-foto-zoom');
  const botonGuardar = $('[value="ok"]', dialogo);
  const url = URL.createObjectURL(archivo);

  marco.classList.toggle('retrato', retrato);
  zoom.value = '1';
  botonGuardar.disabled = true;
  imagen.src = url;
  editorFotoActual = { dialogo, marco, imagen, zoom, url, zoomReal: 1, offsetX: 0, offsetY: 0, natural: null, drag: null, recorte: null, alGuardar, alCancelar };

  imagen.onload = () => {
    const estado = editorFotoActual;
    if (!estado) return;
    estado.natural = { width: imagen.naturalWidth, height: imagen.naturalHeight };
    estado.offsetX = 0;
    estado.offsetY = 0;
    actualizarEditorFoto();
    botonGuardar.disabled = false;
  };
  imagen.onerror = () => {
    const estado = editorFotoActual;
    if (!estado) return;
    URL.revokeObjectURL(url);
    editorFotoActual = null;
    estado.alCancelar?.();
    dialogo.close();
    aviso('No se pudo abrir esta imagen. Prueba con otro archivo.');
  };
  dialogo.returnValue = '';
  dialogo.showModal();
}

function actualizarEditorFoto() {
  const estado = editorFotoActual;
  if (!estado?.natural) return;
  const { marco, imagen, natural, zoomReal } = estado;
  const rect = marco.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const base = Math.max(rect.width / natural.width, rect.height / natural.height);
  const ancho = natural.width * base * zoomReal;
  const alto = natural.height * base * zoomReal;
  const limiteX = Math.max(0, (ancho - rect.width) / 2);
  const limiteY = Math.max(0, (alto - rect.height) / 2);
  estado.offsetX = Math.max(-limiteX, Math.min(limiteX, estado.offsetX));
  estado.offsetY = Math.max(-limiteY, Math.min(limiteY, estado.offsetY));
  imagen.style.width = `${ancho}px`;
  imagen.style.height = `${alto}px`;
  imagen.style.transform = `translate(calc(-50% + ${estado.offsetX}px), calc(-50% + ${estado.offsetY}px))`;
}

function recortarFotoEditor() {
  const estado = editorFotoActual;
  if (!estado?.natural) return null;
  const { marco, imagen, natural, zoomReal, offsetX, offsetY } = estado;
  const rect = marco.getBoundingClientRect();
  const base = Math.max(rect.width / natural.width, rect.height / natural.height) * zoomReal;
  const anchoRender = natural.width * base;
  const altoRender = natural.height * base;
  const xRender = rect.width / 2 + offsetX - anchoRender / 2;
  const yRender = rect.height / 2 + offsetY - altoRender / 2;
  const fuenteX = Math.max(0, -xRender / anchoRender * natural.width);
  const fuenteY = Math.max(0, -yRender / altoRender * natural.height);
  const fuenteAncho = Math.min(natural.width - fuenteX, rect.width / anchoRender * natural.width);
  const fuenteAlto = Math.min(natural.height - fuenteY, rect.height / altoRender * natural.height);

  const salida = document.createElement('canvas');
  salida.width = retratoMarcoActivo() ? 466 : 800;
  salida.height = retratoMarcoActivo() ? 683 : 1000;
  const contexto = salida.getContext('2d');
  contexto.drawImage(imagen, fuenteX, fuenteY, fuenteAncho, fuenteAlto, 0, 0, salida.width, salida.height);
  return salida.toDataURL('image/jpeg', 0.84);
}

function retratoMarcoActivo() {
  return !!editorFotoActual?.marco.classList.contains('retrato');
}

$('#d-ajustar-foto form').addEventListener('submit', e => {
  const estado = editorFotoActual;
  if (!estado || e.submitter?.value !== 'ok') return;
  e.preventDefault();
  estado.recorte = recortarFotoEditor();
  if (estado.recorte) estado.dialogo.close('ok');
});

$('#editor-foto-zoom').addEventListener('input', e => {
  if (!editorFotoActual) return;
  editorFotoActual.zoomReal = +e.target.value;
  actualizarEditorFoto();
});
$('#editor-foto').addEventListener('pointerdown', e => {
  if (!editorFotoActual) return;
  editorFotoActual.drag = { x: e.clientX, y: e.clientY, offsetX: editorFotoActual.offsetX, offsetY: editorFotoActual.offsetY };
  e.currentTarget.setPointerCapture(e.pointerId);
  e.currentTarget.classList.add('arrastrando');
});
$('#editor-foto').addEventListener('pointermove', e => {
  const estado = editorFotoActual;
  if (!estado?.drag) return;
  estado.offsetX = estado.drag.offsetX + e.clientX - estado.drag.x;
  estado.offsetY = estado.drag.offsetY + e.clientY - estado.drag.y;
  actualizarEditorFoto();
});
$('#editor-foto').addEventListener('pointerup', e => {
  if (!editorFotoActual) return;
  editorFotoActual.drag = null;
  e.currentTarget.classList.remove('arrastrando');
});
$('#d-ajustar-foto').addEventListener('close', () => {
  const estado = editorFotoActual;
  if (!estado) return;
  if ($('#d-ajustar-foto').returnValue === 'ok') {
    if (estado.recorte) estado.alGuardar(estado.recorte);
  } else if (estado.alCancelar) {
    estado.alCancelar();
  }
  URL.revokeObjectURL(estado.url);
  editorFotoActual = null;
});
$('#cancelar-ajustar-foto').addEventListener('click', () => {
  $('#d-ajustar-foto').returnValue = 'cancelar';
  $('#d-ajustar-foto').close();
});
// clave = comienzo de los textos "-titulo", "-texto" y "-boton" del bloque de textos.
function confirmar(clave, datos, accion) {
  const d = $('#d-confirmar');
  $('h2', d).textContent = texto(clave + '-titulo', datos);
  $('p', d).textContent = texto(clave + '-texto', datos);
  $('[value=ok]', d).textContent = texto(clave + '-boton', datos);
  abrir(d, {}, (_, valor) => valor === 'ok' && accion());
}

function formPerfil(p) {
  const d = $('#d-perfil');
  $('h2', d).textContent = texto(p ? 'perfil-editar' : 'perfil-nuevo');
  abrir(d, p || {}, (datos, valor) => {
    if (valor !== 'ok') return;
    const tonos = [350, 20, 42, 95, 150, 190, 215, 260, 300];
    if (!p) estado.perfiles.push(p = { id: uid(), hue: tonos[Math.random() * tonos.length | 0], foto: '', privado: false, objetos: [], conexiones: [] });
    Object.assign(p, datos);
    guardar();
    ir('#/perfil/' + p.id);
  });
}

function formObjeto(o) {
  const { p } = actual, d = $('#d-objeto');
  $('h2', d).textContent = texto(o ? 'recuerdo-editar' : 'recuerdo-nuevo');
  abrir(d, { ...o, tipo: nombreTipo(o?.tipo || '') }, (datos, valor) => {
    if (valor !== 'ok') return;
    if (!o) p.objetos.push(o = { id: uid(), foto: '', nombre: datos.tipo, ...posicionLibre(p) });
    Object.assign(o, datos);
    guardar();
    render();
    aviso(texto('aviso-guardado'));
  });
}

// Busca una posición inicial para un recuerdo nuevo.
function posicionLibre(p) {
  let mejor, distancia = -1;
  for (let i = 0; i < 40; i++) {
    const x = 14 + Math.random() * 72, y = 16 + Math.random() * 62;
    const d = Math.min(...p.objetos.map(o => Math.hypot(o.x - x, o.y - y)));
    if (d > distancia) { distancia = d; mejor = { x: +x.toFixed(1), y: +y.toFixed(1) }; }
  }
  return mejor;
}

// ---------- Botones con data-accion ----------
const acciones = {
  'nuevo-perfil': () => formPerfil(),
  'editar-perfil': () => formPerfil(actual.p),
  'eliminar-perfil': () => confirmar('borrar-perfil', { nombre: actual.p.nombre }, () => {
      estado.perfiles = estado.perfiles.filter(x => x !== actual.p);
      guardar();
      ir('#/coleccion');
    }),
  'nuevo-objeto': () => formObjeto(),
  'editar-objeto': () => formObjeto(actual.o),
  'eliminar-objeto': () => {
    const { p, o } = actual;
    confirmar('borrar-recuerdo', { nombre: o.nombre }, () => {
      p.objetos = p.objetos.filter(x => x !== o);
      p.conexiones = p.conexiones.filter(c => c.a !== o.id && c.b !== o.id);
      guardar();
      ir('#/perfil/' + p.id);
    });
  },
};

document.addEventListener('click', e => {
  if (e.target.matches('dialog') || e.target.closest('[data-cerrar]')) {
    const dialog = e.target.closest('dialog');
    if (dialog.querySelector('[value=ok]')?.disabled) return;
    return dialog.close();
  }
  const el = e.target.closest('[data-accion]');
  if (!el) return;
  const soloLectura = new Set(['editar-perfil', 'eliminar-perfil', 'unir', 'nuevo-objeto', 'editar-objeto', 'eliminar-objeto']);
  if (actual.p?.soloLectura && soloLectura.has(el.dataset.accion)) return;
  acciones[el.dataset.accion]?.(el);
});
document.addEventListener('change', e => {
  if (e.target.closest('.campo-imagen')) {
    const input = e.target;
    mostrarArchivo(input);
    const archivo = input.files[0];
    if (!archivo) return;
    ajustarFoto(archivo, input.closest('#d-perfil') !== null, recorte => {
      ajustesFoto.set(input, recorte);
      const previa = input.nextElementSibling;
      previa.replaceChildren(Object.assign(document.createElement('img'), { src: recorte }));
    }, () => {
      input.value = '';
      mostrarArchivo(input);
    });
  }
});
$('#foto-objeto').addEventListener('change', async e => {
  if (actual.p?.soloLectura) return;
  const archivo = e.target.files[0];
  if (!archivo) return;
  ajustarFoto(archivo, false, recorte => {
    actual.o.foto = recorte;
    e.target.value = '';
    guardar();
    render();
    aviso(texto('aviso-foto'));
  }, () => {
    e.target.value = '';
  });
});

// ---------- Navegación ----------
const ir = h => (location.hash === h ? render() : (location.hash = h));
addEventListener('hashchange', () => {
  if (location.hash && !location.hash.startsWith('#/')) return;
  render(true);
});

// ---------- Aviso ----------
let avisoTimer;
function aviso(texto) {
  const a = $('#aviso');
  a.textContent = texto;
  a.classList.add('visible');
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => a.classList.remove('visible'), 3200);
}

let sesionActual = null, modoRecuperacion = false, modoRegistro = false;
let cargaCuentaId = null, cargaCuentaPromesa = null;

function mostrarAcceso(mensaje = '') {
  $('#form-acceso').hidden = !clienteSupabase;
  if (!$('#acceso').open) $('#acceso').showModal();
  $('#acceso-mensaje').textContent = mensaje;
}

function mostrarSitio() {
  authLista = true;
  errorCarga = '';
  $('#cuenta-correo').textContent = usuarioActual.email || '';
  $('#cuenta-correo').hidden = false;
  $('#cerrar-sesion').hidden = false;
  $('#seguir-explorando').hidden = false;
  if ($('#acceso').open) $('#acceso').close();
  render(true);
}

async function cargarCuenta(session) {
  if (!session) {
    sesionActual = null;
    usuarioActual = null;
    estado = null;
    modoRecuperacion = false;
    modoRegistro = false;
    $('#form-acceso').hidden = false;
    $('#form-nueva-clave').hidden = true;
    $('#crear-cuenta').hidden = false;
    $('#crear-cuenta').textContent = 'Crear cuenta';
    $('#recuperar-clave').hidden = false;
    $('#entrar').textContent = 'Iniciar sesión';
    $('#acceso h1').textContent = 'Iniciar sesión';
    $('#reintentar-carga').hidden = true;
    $('#cerrar-sesion-acceso').hidden = true;
    $('#cuenta-correo').hidden = true;
    $('#cerrar-sesion').hidden = true;
    authLista = true;
    errorCarga = '';
    if ($('#acceso').open && !modoRecuperacion) $('#acceso').close();
    render(true);
    return;
  }
  sesionActual = session;
  usuarioActual = session.user;
  if (modoRecuperacion) return;
  if (estado && estado.usuarioId === session.user.id) return;
  if (cargaCuentaId === session.user.id) return cargaCuentaPromesa;

  const userId = session.user.id;
  cargaCuentaId = userId;
  if (location.hash === '#/coleccion' || $('#acceso').open) {
    mostrarAcceso('Cargando tu respaldo…');
    $('#form-acceso').hidden = true;
    $('#reintentar-carga').hidden = true;
  }
  cargaCuentaPromesa = (async () => {
    try {
      const { data, error } = await clienteSupabase.from('user_backups')
        .select('payload').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      if (sesionActual?.user?.id !== userId) return;
      let perfiles;
      if (data) {
        if (data.payload?.version !== 1 || !Array.isArray(data.payload.perfiles)
          || data.payload.perfiles.some(p => !perfilValido(p))) {
          throw new Error('El respaldo de esta cuenta tiene un formato que no se reconoce.');
        }
        perfiles = data.payload.perfiles;
      } else {
        perfiles = [];
        const { error: errorInicial } = await clienteSupabase.from('user_backups').upsert({
          user_id: userId,
          payload: { version: 1, perfiles },
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
        if (errorInicial) throw errorInicial;
      }
      if (sesionActual?.user?.id !== userId) return;
      estado = { firma, usuarioId: userId, perfiles };
      authLista = true;
      errorRespaldo = false;
      $('#estado-respaldo').textContent = 'Respaldo sincronizado.';
      actualizarImportacionLocal();
      mostrarSitio();
    } catch (error) {
      console.error('No se pudo cargar el respaldo de la cuenta.', error);
      if (sesionActual?.user?.id === userId) {
        estado = null;
        authLista = true;
        errorCarga = 'No se pudo cargar el respaldo. Revisa la conexión y vuelve a intentarlo.';
        if ($('#acceso').open || location.hash === '#/coleccion') {
          mostrarAcceso(errorCarga);
          $('#reintentar-carga').hidden = false;
          $('#cerrar-sesion-acceso').hidden = false;
        } else render(true);
      }
    } finally {
      if (cargaCuentaId === userId) {
        cargaCuentaId = null;
        cargaCuentaPromesa = null;
      }
    }
  })();
  return cargaCuentaPromesa;
}

function mostrarErrorAcceso(error) {
  console.error('Falló la operación de cuenta.', error);
  $('#acceso-mensaje').textContent = error.message || 'No se pudo completar la operación. Inténtalo de nuevo.';
}

if (!clienteSupabase) {
  authLista = true;
  $('#form-acceso').hidden = true;
  $('#reintentar-carga').hidden = true;
  render(true);
} else {
  clienteSupabase.auth.getSession().then(({ data, error }) => {
    if (error) throw error;
    return cargarCuenta(data.session);
  }).catch(error => {
    mostrarErrorAcceso(error);
    errorCarga = error.message || 'No se pudo comprobar la sesión. Inténtalo de nuevo.';
    authLista = true;
    render(true);
  });

  clienteSupabase.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION') return;
    if (event === 'PASSWORD_RECOVERY') {
      modoRecuperacion = true;
      sesionActual = session;
      usuarioActual = session?.user || null;
      estado = null;
      mostrarAcceso('Escribe una nueva contraseña para tu cuenta.');
      $('#form-acceso').hidden = true;
      $('#form-nueva-clave').hidden = false;
      $('#seguir-explorando').hidden = true;
      return;
    }
    if (event === 'SIGNED_OUT') {
      void cargarCuenta(null);
      return;
    }
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
      setTimeout(() => { void cargarCuenta(session); }, 0);
    }
  });
}

$('#crear-cuenta').addEventListener('click', () => {
  modoRegistro = !modoRegistro;
  $('#entrar').textContent = modoRegistro ? 'Crear cuenta' : 'Iniciar sesión';
  $('#crear-cuenta').textContent = modoRegistro ? 'Ya tengo una cuenta' : 'Crear cuenta';
  $('#recuperar-clave').hidden = modoRegistro;
  $('#campo-clave input').autocomplete = modoRegistro ? 'new-password' : 'current-password';
  $('#acceso h1').textContent = modoRegistro ? 'Crear cuenta' : 'Iniciar sesión';
  $('#acceso-mensaje').textContent = modoRegistro ? 'Usa una contraseña de al menos 8 caracteres.' : '';
});

$('#form-acceso').addEventListener('submit', async e => {
  e.preventDefault();
  if (!clienteSupabase) return;
  const formulario = e.currentTarget;
  const email = formulario.elements.email.value.trim();
  const password = formulario.elements.password.value;
  const boton = $('#entrar');
  boton.disabled = true;
  try {
    if (modoRegistro) {
      const { data, error } = await clienteSupabase.auth.signUp({
        email, password,
        options: { emailRedirectTo: location.origin + location.pathname }
      });
      if (error) throw error;
      if (data.session) await cargarCuenta(data.session);
      else $('#acceso-mensaje').textContent = 'Cuenta creada. Revisa tu correo para confirmar el registro e iniciar sesión.';
    } else {
      const { data, error } = await clienteSupabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await cargarCuenta(data.session);
    }
  } catch (error) {
    mostrarErrorAcceso(error);
  } finally {
    boton.disabled = false;
  }
});

$('#recuperar-clave').addEventListener('click', async () => {
  if (!clienteSupabase) return;
  const email = $('#form-acceso').elements.email.value.trim();
  if (!email) {
    $('#acceso-mensaje').textContent = 'Escribe tu correo electrónico y vuelve a intentarlo.';
    $('#form-acceso').elements.email.focus();
    return;
  }
  try {
    const { error } = await clienteSupabase.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + location.pathname
    });
    if (error) throw error;
    $('#acceso-mensaje').textContent = 'Si existe una cuenta con ese correo, recibirás instrucciones para recuperar el acceso.';
  } catch (error) {
    mostrarErrorAcceso(error);
  }
});

$('#form-nueva-clave').addEventListener('submit', async e => {
  e.preventDefault();
  if (!clienteSupabase) return;
  try {
    const password = e.currentTarget.elements.password.value;
    const { data, error } = await clienteSupabase.auth.updateUser({ password });
    if (error) throw error;
    modoRecuperacion = false;
    $('#form-acceso').hidden = false;
    $('#form-nueva-clave').hidden = true;
    await cargarCuenta(data.session || sesionActual);
  } catch (error) {
    mostrarErrorAcceso(error);
  }
});

$('#reintentar-carga').addEventListener('click', async () => {
  if (!clienteSupabase) return;
  try {
    const { data, error } = await clienteSupabase.auth.getSession();
    if (error) throw error;
    await cargarCuenta(data.session);
  } catch (error) {
    mostrarErrorAcceso(error);
  }
});

$('#cerrar-sesion').addEventListener('click', async () => {
  if (!clienteSupabase) return;
  if (estado) {
    await guardar();
    await colaRespaldo;
    if (errorRespaldo) return;
  }
  try {
    location.hash = '#/explorar';
    const { error } = await clienteSupabase.auth.signOut();
    if (error) throw error;
  } catch (error) {
    console.error('No se pudo cerrar la sesión.', error);
    aviso('No se pudo cerrar la sesión. Inténtalo de nuevo.');
  }
});

$('#cerrar-sesion-acceso').addEventListener('click', async () => {
  try {
    const { error } = await clienteSupabase.auth.signOut();
    if (error) throw error;
  } catch (error) {
    console.error('No se pudo cerrar la sesión.', error);
    $('#acceso-mensaje').textContent = error.message || 'No se pudo cerrar la sesión. Inténtalo de nuevo.';
  }
});

$('#reintentar-respaldo').addEventListener('click', () => { void guardar(); });
$('#importar-datos-locales').addEventListener('click', () => { void importarDatosLocales(); });

$('#seguir-explorando').addEventListener('click', () => {
  location.hash = '#/explorar';
  $('#acceso').close();
});
$('#acceso').addEventListener('cancel', e => {
  if (modoRecuperacion) e.preventDefault();
});
$('#acceso').addEventListener('close', () => {
  $('#seguir-explorando').hidden = false;
  if (!usuarioActual && location.hash === '#/coleccion') location.hash = '#/explorar';
});
