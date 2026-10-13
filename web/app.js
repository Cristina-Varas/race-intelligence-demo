'use strict';
const $ = (id) => document.getElementById(id);
const form = $('scenario-form');
let documentData = null;
let scenario = null;
let busy = false;
let currentExecution = '';
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const fixed = (value, digits = 2) => value == null ? 'Not reached' : Number(value).toFixed(digits);

function chart(data) {
  const svg = $('curve');
  svg.replaceChildren();
  const ns = 'http://www.w3.org/2000/svg';
  function node(tag, attrs, text) {
    const n = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, String(value));
    if (text != null) n.textContent = text;
    svg.append(n);
    return n;
  }
  const curve = data.curve.filter(p => p.delaySeconds >= 0);
  const xmax = Math.max(1, ...curve.map(p => p.delaySeconds));
  const x = d => 58 + d / xmax * 875;
  const y = p => 244 - p * 210;
  [0, .25, .5, .75, 1].forEach(p => {
    node('line', {x1:58,x2:933,y1:y(p),y2:y(p),class:'grid'});
    node('text', {x:8,y:y(p)+4}, `${p*100}%`);
  });
  [0,.25,.5,.75,1].forEach(f => node('text',{x:x(f*xmax),y:272,'text-anchor':'middle'}, `${fixed(f*xmax,1)} s`));
  node('polyline', {points:curve.map(p => `${x(p.delaySeconds)},${y(p.catchProbability)}`).join(' '),class:'line'});
  node('circle',{cx:x(data.delay_seconds),cy:y(data.full_field_probability),r:6,class:'marker'});
}

function card() {
  if (!scenario) return;
  const driver = scenario.drivers.find(d => d.driverId === $('participant').value);
  if (!driver) return;
  $('card-title').textContent = driver.driverId;
  $('card-pace').textContent = `${fixed(driver.driverPace)} s`;
  $('card-lap').textContent = driver.catchPossibleWithinRace ? fixed(driver.catchLapExact) : 'Not reached';
  $('card-probability').textContent = percent(driver.catchProbability);
}

function render(result, execution) {
  scenario = result;
  currentExecution = execution;
  $('probability').textContent = percent(result.full_field_probability);
  $('delay-limit').textContent = `${fixed(result.deterministic_max_delay_seconds)} s`;
  $('pace').textContent = `${fixed(result.challenger_pace_seconds)} s`;
  $('sample-count').textContent = `${result.simulations.toLocaleString()} SEEDED RUNS · SEED ${result.simulation_seed}`;
  $('status').textContent = `${execution} · ${result.field_size} synthetic participants · ${result.race_laps} laps · ${result.delay_seconds} s delay`;
  chart(result);
  const previous = $('participant').value;
  $('participant').replaceChildren();
  $('drivers').replaceChildren();
  result.drivers.forEach(driver => {
    const option = document.createElement('option');
    option.value = driver.driverId; option.textContent = driver.driverId;
    $('participant').append(option);
    const row = document.createElement('tr');
    [driver.driverId, fixed(driver.driverPace), driver.catchPossibleWithinRace ? fixed(driver.catchLapExact) : 'Not reached', percent(driver.catchProbability)].forEach(value => {
      const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
    });
    $('drivers').append(row);
  });
  if (result.drivers.some(d => d.driverId === previous)) $('participant').value = previous;
  card();
  $('download').disabled = false;
}

function showError(error) {
  $('error').hidden = false;
  $('error').textContent = error.message || 'Unable to load the demonstration.';
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

form.addEventListener('input', () => {
  if (!busy) $('status').textContent = 'Inputs changed. Run scenario to update results; the displayed result is the previous calculation.';
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !documentData) return;
  busy = true;
  const payload = Object.fromEntries([...new FormData(form)].map(([key,value]) => [key, Number(value)]));
  payload.simulations = 1000;
  for (const control of form.elements) control.disabled = true;
  $('download').disabled = true;
  $('error').hidden = true;
  $('status').textContent = 'Calculating a local what-if scenario from the published synthetic profiles…';
  try {
    const result = await request('/api/simulate', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    render(result.scenario, result.execution);
  } catch (error) {
    showError(error);
    $('status').textContent = 'Calculation failed. Previous result remains displayed; no replacement result has been invented.';
  } finally {
    for (const control of form.elements) control.disabled = false;
    $('download').disabled = !scenario;
    busy = false;
  }
});
$('participant').addEventListener('change', card);
$('download').addEventListener('click', () => {
  if (!scenario) return;
  const payload = {execution:currentExecution,input_execution:documentData.execution,input_gold_sha256:documentData.gold_sha256,scenario};
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
  const link = document.createElement('a'); link.href=url; link.download=`synthetic-race-scenario-${scenario.field_size}.json`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
});

(async () => {
  for (const control of form.elements) control.disabled = true;
  try {
    documentData = await request('/api/demo');
    $('execution').textContent = `INPUT EXECUTION: ${documentData.execution}`;
    $('bronze-count').textContent = documentData.counts.bronze;
    $('silver-count').textContent = documentData.counts.silver;
    $('gold-count').textContent = documentData.counts.profiles;
    render(documentData.scenarios['16'], documentData.execution);
    for (const control of form.elements) control.disabled = false;
  } catch (error) {
    $('status').textContent = 'No valid serving artifact is available.';
    showError(error);
  }
})();
