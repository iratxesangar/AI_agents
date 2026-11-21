const tripQuestions = {
  destino: "¿Adónde quieres viajar? Indica un país, una ciudad o los destinos que barajas.",
  fechas: "¿En qué fechas viajas o cuántos días y noches tienes?",
  origen: "¿Desde qué ciudad o aeropuerto saldrías?",
  viajeros: "¿Cuántas personas viajáis?"
};

function nextTripStep(state, connection, hasAcceptance, hasServiceQuestions) {
  const field = Object.keys(tripQuestions).find((key) => !state.sheet[key]?.trim());
  if (field) return {stage: 1, field, text: tripQuestions[field], placeholder: "Escribe tu respuesta"};
  if (!state.route && !state.research && !state.comparison && !state.intakeOptionalDone
      && !state.sheet.preferencias?.trim()) {
    return {stage: 1, field: "preferencias", optional: true,
      text: "¿Qué te apetece hacer y qué necesitas tener en cuenta? Puedes mencionar imprescindibles, ritmo o presupuesto aproximado.",
      placeholder: "Por ejemplo, senderismo y dos tardes tranquilas"};
  }
  if (state.comparison) return {stage: 3, action: "comparison", text: "Compara las propuestas en la conversación y elige la que quieras revisar.", label: "Ver rutas"};
  if (state.draft.trim() && state.draft.trim() !== state.route) {
    return {stage: 4, action: "save", text: "Tu borrador tiene cambios. Guarda la versión para revisarla.", label: "Guardar versión"};
  }
  if (!state.route) {
    if (connection.model && connection.search && !state.research) {
      return {stage: 2, action: "research", text: "La ficha está lista. Puedo investigar el destino y guardar las fuentes para comparar rutas.", label: "Investigar destino"};
    }
    if (connection.model) {
      return {stage: 3, action: "propose", text: state.research
        ? "Ya tengo la investigación. Puedo usarla para comparar hasta tres rutas."
        : "Puedo preparar propuestas preliminares. La búsqueda de fuentes requiere configurar Tavily.",
      label: "Proponer ruta"};
    }
    return {stage: 3, action: "manual", text: "La ficha está lista. Puedes escribir y guardar una ruta mientras Gemini esté sin configurar.", label: "Escribir ruta"};
  }
  if (!hasAcceptance) return {stage: 4, action: "review", text: "Revisa el ritmo, las noches y el presupuesto. Puedes pedir cambios o aceptar esta versión cuando estés conforme.", label: "Revisar ruta"};
  if (state.services) return {stage: 6, action: "summary", text: "La comparación está lista. Puedes reunir la ruta, las opciones y las comprobaciones pendientes en un resumen.", label: "Ver resumen"};
  if (hasServiceQuestions) return {stage: 5, action: "pending-services", text: "Para continuar la comparación, completa los datos pendientes que aparecen debajo.", label: "Completar datos"};
  if (connection.model && connection.search) return {stage: 5, action: "services", text: "La ruta está aceptada. Puedes indicar prioridades y comparar servicios para esta versión.", label: "Buscar servicios"};
  return {stage: 5, action: "summary", text: "La ruta está aceptada. Puedes consultar el resumen. La comparación requiere las conexiones de Gemini y Tavily.", label: "Ver resumen"};
}
