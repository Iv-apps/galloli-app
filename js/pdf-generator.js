// pdf-generator.js - Generador de PDFs sin logo
const PDFGenerator = {
    // Generar recibo en PDF
    async generateReceipt(sale, client) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        // Encabezado - centrado y con mejor espaciado
        doc.setFontSize(24);
        doc.setTextColor(76, 175, 80);
        const appName = ConfigModule.currentConfig?.appName || 'GallOli';
        doc.text(appName, 105, 25, { align: 'center' });
        
        doc.setFontSize(11);
        doc.setTextColor(120);
        doc.text('Venta de Pollos Pelados', 105, 35, { align: 'center' });
        
        // Línea separadora
        doc.setDrawColor(76, 175, 80);
        doc.setLineWidth(0.5);
        doc.line(15, 42, 195, 42);
        
        // Información de venta
        doc.setFontSize(10);
        doc.setTextColor(0);
        
        let y = 52;
        doc.text(`Fecha: ${sale.date} ${sale.time}`, 15, y);
        doc.text(`Recibo #${sale.id}`, 150, y);
        
        y += 10;
        doc.setFontSize(12);
        doc.text(`Cliente: ${client.name}`, 15, y);
        
        y += 8;
        doc.setFontSize(10);
        doc.text(`Teléfono: ${client.phone}`, 15, y);
        
        y += 8;
        doc.text(`Dirección: ${client.address}`, 15, y);
        
        // Detalles de venta
        y += 15;
        doc.setDrawColor(200);
        doc.line(15, y, 195, y);
        
        y += 10;
        doc.setFontSize(11);
        doc.text('Descripción', 15, y);
        doc.text('Cantidad', 100, y);
        doc.text('Precio', 140, y);
        doc.text('Total', 170, y);
        
        y += 5;
        doc.line(15, y, 195, y);
        
        y += 10;
        doc.setFontSize(10);
        doc.text(`Pollos pelados (${sale.averageWeight} lb/u)`, 15, y);
        doc.text(`${sale.quantity}`, 100, y);
        doc.text(`$${sale.price.toFixed(2)}/lb`, 140, y);
        doc.text(`$${sale.total.toFixed(2)}`, 170, y);
        
        y += 5;
        doc.text(`Peso total: ${sale.weight.toFixed(2)} lb`, 15, y);
        
        // Total
        y += 15;
        doc.setDrawColor(76, 175, 80);
        doc.setLineWidth(1);
        doc.line(15, y, 195, y);
        
        y += 10;
        doc.setFontSize(14);
        doc.setTextColor(76, 175, 80);
        doc.text('TOTAL:', 140, y);
        doc.text(`$${sale.total.toFixed(2)}`, 170, y);
        
        // Pie de página
        doc.setFontSize(9);
        doc.setTextColor(150);
        doc.text('Gracias por su compra', 105, 280, { align: 'center' });
        doc.text(ConfigModule.currentConfig?.appName || 'GallOli', 105, 285, { align: 'center' });
        
        // Descargar
        doc.save(`recibo_${sale.id}_${sale.date}.pdf`);
    },
    
    // Generar reporte de ventas
    async generateSalesReport(sales, startDate, endDate) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        // Encabezado - centrado y con mejor espaciado
        doc.setFontSize(22);
        doc.setTextColor(76, 175, 80);
        const appName = ConfigModule.currentConfig?.appName || 'GallOli';
        doc.text(appName, 105, 20, { align: 'center' });
        
        doc.setFontSize(16);
        doc.text('Reporte de Ventas', 105, 30, { align: 'center' });
        
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`Período: ${startDate} - ${endDate}`, 105, 38, { align: 'center' });
        
        doc.setDrawColor(76, 175, 80);
        doc.line(15, 45, 195, 45);
        
        // Resumen
        let y = 55;
        const totalVentas = sales.reduce((sum, s) => sum + s.total, 0);
        const totalPeso = sales.reduce((sum, s) => sum + s.weight, 0);
        const totalPollos = sales.reduce((sum, s) => sum + s.quantity, 0);
        
        doc.setFontSize(11);
        doc.setTextColor(0);
        doc.text(`Total de ventas: ${sales.length}`, 15, y);
        y += 8;
        doc.text(`Peso total: ${totalPeso.toFixed(2)} lb`, 15, y);
        y += 8;
        doc.text(`Pollos vendidos: ${totalPollos}`, 15, y);
        y += 8;
        doc.setFontSize(13);
        doc.setTextColor(76, 175, 80);
        doc.text(`Ingresos totales: $${totalVentas.toFixed(2)}`, 15, y);
        
        // Lista de ventas
        y += 15;
        doc.setFontSize(10);
        doc.setTextColor(0);
        
        sales.slice(0, 20).forEach((sale, i) => {
            if (y > 270) {
                doc.addPage();
                y = 20;
            }
            
            const client = ClientsModule.getClientById(sale.clientId);
            doc.text(`${i + 1}. ${client?.name || 'N/A'} - ${sale.date}`, 15, y);
            doc.text(`$${sale.total.toFixed(2)}`, 170, y);
            y += 6;
        });
        
        doc.save(`reporte_ventas_${startDate}_${endDate}.pdf`);
    }
};
