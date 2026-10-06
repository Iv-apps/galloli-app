// Sistema de Select Personalizado con Búsqueda
const CustomSelect = {
    instances: [],
    
    /**
     * Convierte un select nativo en un select personalizado con búsqueda
     * @param {string} selectId - ID del select a convertir
     * @param {object} options - Opciones de configuración
     */
    init(selectId, options = {}) {
        const select = document.getElementById(selectId);
        if (!select || select.tagName !== 'SELECT') {
            console.warn(`Select con ID "${selectId}" no encontrado`);
            return null;
        }
        
        // Verificar si ya está inicializado
        if (select.dataset.customSelect === 'true') {
            return this.instances.find(i => i.selectId === selectId);
        }
        
        const config = {
            placeholder: options.placeholder || 'Seleccionar...',
            searchPlaceholder: options.searchPlaceholder || 'Buscar...',
            noResultsText: options.noResultsText || 'No se encontraron resultados',
            allowClear: options.allowClear !== false,
            ...options
        };
        
        // Crear estructura del select personalizado
        const wrapper = document.createElement('div');
        wrapper.className = 'custom-select-wrapper';
        wrapper.id = `custom-select-${selectId}`;
        
        const customSelect = document.createElement('div');
        customSelect.className = 'custom-select';
        
        // Trigger (botón que abre el dropdown)
        const trigger = document.createElement('div');
        trigger.className = 'custom-select-trigger';
        trigger.innerHTML = `
            <span class="selected-text placeholder">${config.placeholder}</span>
            <span class="arrow">▼</span>
        `;
        
        // Dropdown
        const dropdown = document.createElement('div');
        dropdown.className = 'custom-select-dropdown';
        
        // Búsqueda
        const searchContainer = document.createElement('div');
        searchContainer.className = 'custom-select-search';
        searchContainer.innerHTML = `
            <input type="text" placeholder="${config.searchPlaceholder}" autocomplete="off">
        `;
        
        // Opciones
        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'custom-select-options';
        
        // Construir opciones desde el select original
        this.buildOptions(select, optionsContainer);
        
        // Ensamblar
        dropdown.appendChild(searchContainer);
        dropdown.appendChild(optionsContainer);
        customSelect.appendChild(trigger);
        customSelect.appendChild(dropdown);
        wrapper.appendChild(customSelect);
        
        // Insertar después del select original
        select.parentNode.insertBefore(wrapper, select.nextSibling);
        select.style.display = 'none';
        select.dataset.customSelect = 'true';
        
        // Crear instancia
        const instance = {
            selectId,
            select,
            wrapper,
            trigger,
            dropdown,
            searchInput: searchContainer.querySelector('input'),
            optionsContainer,
            config,
            isOpen: false
        };
        
        // Event listeners
        this.attachEvents(instance);
        
        // Guardar instancia
        this.instances.push(instance);
        
        return instance;
    },
    
    /**
     * Construye las opciones del dropdown desde el select original
     */
    buildOptions(select, container) {
        container.innerHTML = '';
        
        Array.from(select.options).forEach(option => {
            if (option.value === '') return; // Saltar opción vacía
            
            const optionEl = document.createElement('div');
            optionEl.className = 'custom-select-option';
            optionEl.textContent = option.textContent;
            optionEl.dataset.value = option.value;
            
            if (option.selected) {
                optionEl.classList.add('selected');
            }
            
            container.appendChild(optionEl);
        });
        
        // Mensaje de sin resultados
        if (container.children.length === 0) {
            container.innerHTML = '<div class="custom-select-no-results">No hay opciones disponibles</div>';
        }
    },
    
    /**
     * Adjunta eventos a la instancia
     */
    attachEvents(instance) {
        const { trigger, dropdown, searchInput, optionsContainer, select } = instance;
        
        // Abrir/cerrar dropdown
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle(instance);
        });
        
        // Búsqueda
        searchInput.addEventListener('input', (e) => {
            this.filter(instance, e.target.value);
        });
        
        // Prevenir que el click en el search cierre el dropdown
        searchInput.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        
        // Seleccionar opción
        optionsContainer.addEventListener('click', (e) => {
            const option = e.target.closest('.custom-select-option');
            if (option && !option.classList.contains('custom-select-no-results')) {
                this.selectOption(instance, option.dataset.value);
            }
        });
        
        // Cerrar al hacer click fuera
        document.addEventListener('click', (e) => {
            if (!instance.wrapper.contains(e.target)) {
                this.close(instance);
            }
        });
        
        // Cerrar con ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && instance.isOpen) {
                this.close(instance);
            }
        });
    },
    
    /**
     * Abre el dropdown
     */
    open(instance) {
        // Cerrar otros dropdowns
        this.instances.forEach(i => {
            if (i !== instance) this.close(i);
        });
        
        instance.isOpen = true;
        instance.trigger.classList.add('active');
        instance.dropdown.classList.add('active');
        instance.searchInput.value = '';
        instance.searchInput.focus();
        
        // Mostrar todas las opciones
        this.filter(instance, '');
    },
    
    /**
     * Cierra el dropdown
     */
    close(instance) {
        instance.isOpen = false;
        instance.trigger.classList.remove('active');
        instance.dropdown.classList.remove('active');
        instance.searchInput.value = '';
    },
    
    /**
     * Alterna el estado del dropdown
     */
    toggle(instance) {
        if (instance.isOpen) {
            this.close(instance);
        } else {
            this.open(instance);
        }
    },
    
    /**
     * Filtra opciones según el texto de búsqueda
     */
    filter(instance, searchText) {
        const options = instance.optionsContainer.querySelectorAll('.custom-select-option');
        const search = searchText.toLowerCase().trim();
        let visibleCount = 0;
        
        options.forEach(option => {
            const text = option.textContent.toLowerCase();
            if (text.includes(search)) {
                option.classList.remove('hidden');
                visibleCount++;
            } else {
                option.classList.add('hidden');
            }
        });
        
        // Mostrar mensaje de sin resultados
        const noResults = instance.optionsContainer.querySelector('.custom-select-no-results');
        if (noResults) noResults.remove();
        
        if (visibleCount === 0 && search !== '') {
            const noResultsEl = document.createElement('div');
            noResultsEl.className = 'custom-select-no-results';
            noResultsEl.textContent = instance.config.noResultsText;
            instance.optionsContainer.appendChild(noResultsEl);
        }
    },
    
    /**
     * Selecciona una opción
     */
    selectOption(instance, value) {
        const { select, trigger, optionsContainer } = instance;
        
        // Actualizar select original
        select.value = value;
        
        // Disparar evento change
        const event = new Event('change', { bubbles: true });
        select.dispatchEvent(event);
        
        // Actualizar UI
        const selectedOption = Array.from(select.options).find(opt => opt.value === value);
        if (selectedOption) {
            const selectedText = trigger.querySelector('.selected-text');
            selectedText.textContent = selectedOption.textContent;
            selectedText.classList.remove('placeholder');
        }
        
        // Actualizar clases de opciones
        optionsContainer.querySelectorAll('.custom-select-option').forEach(opt => {
            opt.classList.toggle('selected', opt.dataset.value === value);
        });
        
        // Cerrar dropdown
        this.close(instance);
    },
    
    /**
     * Actualiza las opciones del select
     */
    refresh(selectId) {
        const instance = this.instances.find(i => i.selectId === selectId);
        if (!instance) return;
        
        this.buildOptions(instance.select, instance.optionsContainer);
        
        // Actualizar texto seleccionado
        const selectedOption = instance.select.options[instance.select.selectedIndex];
        if (selectedOption && selectedOption.value !== '') {
            const selectedText = instance.trigger.querySelector('.selected-text');
            selectedText.textContent = selectedOption.textContent;
            selectedText.classList.remove('placeholder');
        }
    },
    
    /**
     * Destruye una instancia del select personalizado
     */
    destroy(selectId) {
        const index = this.instances.findIndex(i => i.selectId === selectId);
        if (index === -1) return;
        
        const instance = this.instances[index];
        // El wrapper puede haber sido eliminado por innerHTML — verificar antes de remover
        try {
            if (instance.wrapper && instance.wrapper.parentNode) {
                instance.wrapper.remove();
            }
        } catch(e) { /* ignorar si ya no existe en el DOM */ }
        // Restaurar el select original si aún existe en el DOM
        try {
            if (instance.select && instance.select.parentNode) {
                instance.select.style.display = '';
                instance.select.dataset.customSelect = 'false';
            }
        } catch(e) { /* ignorar */ }

        this.instances.splice(index, 1);
    },
    
    /**
     * Inicializa todos los selects con la clase 'custom-select-auto'
     */
    initAll() {
        document.querySelectorAll('select.custom-select-auto').forEach(select => {
            if (select.id && select.dataset.customSelect !== 'true') {
                this.init(select.id);
            }
        });
    }
};

// Inicializar automáticamente cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        CustomSelect.initAll();
    });
} else {
    CustomSelect.initAll();
}

console.log('🎨 Sistema de Select Personalizado inicializado');
