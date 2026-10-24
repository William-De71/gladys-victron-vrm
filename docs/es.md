# Victron VRM

## Presentación

Esta integración trae a Gladys las instalaciones Victron Energy de su cuenta VRM (vrm.victronenergy.com), mediante la [API de VRM](https://vrm-api-docs.victronenergy.com/) oficial y un token de acceso personal. Solo lee: nunca cambia un ajuste de su instalación. No está afiliada a Victron Energy.

- Un dispositivo por instalación: nivel de batería, potencias de carga y descarga de la batería, tensión de la batería, potencia solar y producción solar del día, potencia de la red eléctrica (importación +, exportación −), consumo AC y consumo del día, potencia del generador.
- Cuatro widgets de panel: flujo de energía ahora, hoy (con un gráfico por horas), la previsión de VRM, las alarmas de VRM.
- Disparadores de escena: alarma de VRM activada o terminada, batería baja o llena, red perdida o restablecida, instalación sin conexión o de nuevo en línea, acceso rechazado.
- Acciones de escena: las energías de hoy, la previsión solar y de consumo de hoy y mañana.

Transporte: nube. El token de acceso va a VRM (`vrmapi.victronenergy.com`) y los datos de sus instalaciones vienen de la nube de Victron, que los recibe del dispositivo GX (Cerbo GX, Venus GX, Ekrano…) de cada instalación.

## Requisitos previos

- Gladys Assistant 5.1.0 o posterior.
- Una instalación Victron con un dispositivo GX que envía sus datos a VRM (aparece en vrm.victronenergy.com).
- **Un token de acceso de VRM**: en VRM, abra **Preferences → Integrations → Access tokens** ([enlace directo](https://vrm.victronenergy.com/access-tokens)), cree un token y cópielo. Un token abre toda la cuenta (manténgalo en secreto); la integración solo lee con él.
- Para las previsiones: paneles solares, la ubicación de la instalación en VRM y unos 30 días de historial (una regla de VRM).

Actualidad de los datos: VRM recibe los datos de una instalación al **intervalo de registro** de su dispositivo GX (Ajustes → Portal VRM en línea → Intervalo de registro; a menudo 15 minutos, 1 minuto como mínimo). Leer VRM más a menudo no aporta nada nuevo.

## Configuración

| Campo                               | Significado                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| Token de acceso                     | El token creado en VRM (un secreto, nunca se vuelve a mostrar ni se escribe en los registros)       |
| Lectura de las instalaciones        | Cada 1, 2, 5 (por defecto), 10 o 15 minutos: una petición lee todas las instalaciones               |
| Nivel del disparador «batería baja» | De 10 a 50 % (20 % por defecto)                                                                     |
| Instalación sin conexión tras       | 30 min, 1 h (por defecto), 2 h o 4 h sin datos nuevos en VRM                                        |
| Idioma de los textos                | Nombres de las funciones, textos de escenas y errores; automático sigue el idioma del último widget |

Botones:

- **Probar la conexión** comprueba el token y lista las instalaciones de la cuenta, con la hora de sus últimos datos.
- **Diagnóstico** escribe el estado de la integración en sus registros, sin el token.

## Uso

### Dispositivos

Abra **Descubrir** y añada sus instalaciones. Un dispositivo de instalación tiene:

- **Nivel de batería** (%), **Potencia de carga de la batería** y **Potencia de descarga de la batería** (W, ambas positivas: VRM da la tensión y la corriente, la potencia es su producto), **Tensión de la batería** (V);
- **Producción solar** (W) y **Producción solar de hoy** (kWh), si la instalación tiene solar;
- **Red eléctrica** (W, positiva al importar, negativa al exportar), si tiene una entrada de red o de puerto;
- **Consumo AC** (W) y **Consumo de hoy** (kWh);
- **Potencia del generador** (W), si VRM indica un generador.

Ninguna de estas funciones se cuenta como el consumo de su casa: un Linky u otro contador sigue alimentando solo el panel de energía, sin doble cómputo. Cuando VRM no recibe nada de una instalación durante el plazo de la configuración, sus valores dejan de publicarse (conservan en Gladys su último valor y su hora).

### Widgets del panel

![Los cuatro widgets: flujo de energía ahora, hoy con su gráfico por horas, la previsión de VRM, las alarmas de VRM (ilustración generada, no una captura de pantalla)](https://raw.githubusercontent.com/William-De71/gladys-victron-vrm/main/docs/assets/widgets.es.png)

- **Victron ahora**: nivel de batería, solar, consumo AC, red (hacia o desde), batería (cargando o descargando), generador cuando funciona; el estado del sistema, la tensión de la batería, las alarmas activas y cuándo recibió VRM los últimos datos.
- **Victron hoy**: solar, consumo, importación y exportación del día, autosuficiencia, un gráfico por horas de la producción solar y del consumo, la batería cargada y descargada.
- **Previsión Victron**: la producción solar esperada hoy, lo que aún falta, mañana, el consumo esperado mañana y su gráfico por horas.
- **Alarmas Victron**: el registro de alarmas de VRM, las activas primero, luego las últimas terminadas.

Elija la instalación en los ajustes del widget (vacío: la primera).

### Escenas

Disparadores (una vez por cambio, nunca en la primera lectura):

- **Victron VRM: alarma activada** / **alarma terminada**: una entrada del registro de alarmas de VRM (batería baja, red perdida, sobrecarga, temperatura alta, error del inversor…). Variables: el texto de la alarma, el equipo Victron, las horas de inicio y fin, la duración.
- **Victron VRM: batería baja**: la batería llega al nivel de la configuración (de nuevo tras subir 5 puntos). **Batería llena**: 100 % (de nuevo tras bajar del 95 %).
- **Victron VRM: red perdida** / **red restablecida**: la alarma de red del sistema (red o toma de puerto).
- **Victron VRM: instalación sin conexión** / **de nuevo en línea**: sin datos nuevos en VRM durante el plazo de la configuración.
- **Victron VRM: acceso rechazado**: VRM rechaza el token (revocado, caducado o incorrecto).

Acciones:

- **Victron VRM: energías de hoy**: solar, consumo, importación, exportación, batería cargada y descargada, generador, autosuficiencia, nivel de batería y una frase, según las últimas lecturas (sin petición).
- **Victron VRM: previsión solar**: solar de hoy, pendiente hoy, mañana, consumo de hoy y de mañana (kWh), y una frase.

Ejemplos:

- Cuando **Victron VRM: red perdida** → enviar una notificación «Corte de luz, batería al {{triggerEvent.data.battery_level}} %» y apagar los radiadores conectados al inversor.
- Cada noche a las 21:00 → **Victron VRM: previsión solar**; si **solar mañana** es inferior a 5 kWh → encender el termo en horas valle esta noche.
- Cuando **Victron VRM: alarma activada** → enviar una notificación con {{triggerEvent.data.description}}.

## Solución de problemas

- **«VRM rechaza el token de acceso»**: el token se eliminó o se copió mal. Cree uno nuevo en VRM y péguelo de nuevo (con o sin el prefijo `Token `).
- **Ninguna instalación**: el token pertenece a una cuenta que no ve ninguna instalación; compruébelo en vrm.victronenergy.com con la misma cuenta.
- **Valores que solo cambian cada 15 minutos**: VRM mismo recibe los datos al intervalo de registro del dispositivo GX; redúzcalo en el dispositivo GX (1 minuto) si lo necesita.
- **«No hay previsión»**: VRM necesita paneles solares, la ubicación de la instalación y unos 30 días de historial.
- **Sin registro de alarmas**: a algunas cuentas (instalaciones compartidas, nivel de acceso bajo) se les puede negar el registro; el widget lo indica y se vuelve a pedir una vez al día.
- **«VRM pide ir más despacio»**: VRM respondió 429; la integración espera el plazo indicado por VRM (Retry-After) y luego sigue sola.
- Pulse **Diagnóstico** y mire los registros de la integración (sin el token). Para un error, abra una incidencia en [GitHub](https://github.com/William-De71/gladys-victron-vrm/issues) con las versiones de Gladys y de la integración, y los registros con `DEBUG=gladys-integration-sdk`.
