/**
 * Vortex ERP — محرك تصدير Excel المتعدد المصنفات (Multi-Sheet Excel Engine)
 * المرحلة 7: REP-028 و REP-029
 *
 * الميزات:
 * 1. يدعم أوراق عمل متعددة (Sheet 1: الملخص والمؤشرات، Sheet 2: البيانات التفصيلية).
 * 2. يدعم تنسيق RTL الأصلي لليمين إلى اليسار (DisplayRightToLeft).
 * 3. يدعم التنسيقات الرقمية المناسبة للخلايا المالية والكمية مع ترويسات أنيقة.
 */

import type { ReportExportPayload } from './types';
import type { ReportColumnDefinition } from '../types';

function escapeXml(unsafe: any): string {
  if (unsafe === undefined || unsafe === null) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function generateReportExcelXml(payload: ReportExportPayload): string {
  const { definition, rows, metrics, appliedFilters, currencySymbol = 'ر.س' } = payload;
  const exportableCols: ReportColumnDefinition[] = definition.columns.filter(
    (c) => c.exportable !== false
  );

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center" ss:ReadingOrder="RightToLeft"/>
   <Borders/>
   <Font ss:FontName="Segoe UI" ss:Size="11" ss:Color="#1E293B"/>
   <Interior/>
   <NumberFormat/>
   <Protection/>
  </Style>
  <Style ss:ID="HeaderStyle">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:ReadingOrder="RightToLeft"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
   </Borders>
   <Font ss:FontName="Segoe UI" ss:Size="11" ss:Color="#FFFFFF" ss:Bold="1"/>
   <Interior ss:Color="#0F766E" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="TitleStyle">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center" ss:ReadingOrder="RightToLeft"/>
   <Font ss:FontName="Segoe UI" ss:Size="14" ss:Color="#0F766E" ss:Bold="1"/>
  </Style>
  <Style ss:ID="MetaLabelStyle">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center" ss:ReadingOrder="RightToLeft"/>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Color="#64748B" ss:Bold="1"/>
   <Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="MetaValueStyle">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center" ss:ReadingOrder="RightToLeft"/>
   <Font ss:FontName="Segoe UI" ss:Size="10" ss:Color="#1E293B"/>
  </Style>
  <Style ss:ID="MetricLabelStyle">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center" ss:ReadingOrder="RightToLeft"/>
   <Font ss:FontName="Segoe UI" ss:Size="11" ss:Color="#334155" ss:Bold="1"/>
   <Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="MetricValueStyle">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Font ss:FontName="Segoe UI" ss:Size="12" ss:Color="#0F766E" ss:Bold="1"/>
  </Style>
  <Style ss:ID="DataText">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center" ss:ReadingOrder="RightToLeft"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
  </Style>
  <Style ss:ID="DataNumber">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
   <NumberFormat ss:Format="#,##0.00"/>
  </Style>
  <Style ss:ID="DataInteger">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
   <NumberFormat ss:Format="#,##0"/>
  </Style>
  <Style ss:ID="TotalRowStyle">
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Double" ss:Weight="2" ss:Color="#0F766E"/>
    <Border ss:Position="Bottom" ss:LineStyle="Single" ss:Weight="1" ss:Color="#0F766E"/>
   </Borders>
   <Font ss:FontName="Segoe UI" ss:Size="11" ss:Color="#0F766E" ss:Bold="1"/>
   <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
   <NumberFormat ss:Format="#,##0.00"/>
  </Style>
 </Styles>
`;

  // -------------------------------------------------------------
  // Sheet 1: ملخص ومؤشرات الأداء (REP-029)
  // -------------------------------------------------------------
  xml += ` <Worksheet ss:Name="ملخص ومؤشرات الأداء">
  <Table ss:DefaultRowHeight="22">
   <Column ss:Width="200"/>
   <Column ss:Width="220"/>
   <Row ss:Height="30">
    <Cell ss:MergeAcross="1" ss:StyleID="TitleStyle"><Data ss:Type="String">${escapeXml(definition.titleAr)}</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="MetaLabelStyle"><Data ss:Type="String">تاريخ الاستخراج</Data></Cell>
    <Cell ss:StyleID="MetaValueStyle"><Data ss:Type="String">${escapeXml(new Date().toLocaleString('ar-SA'))}</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="MetaLabelStyle"><Data ss:Type="String">نطاق التقرير</Data></Cell>
    <Cell ss:StyleID="MetaValueStyle"><Data ss:Type="String">${escapeXml(definition.domain)}</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="MetaLabelStyle"><Data ss:Type="String">الفترة المحددة</Data></Cell>
    <Cell ss:StyleID="MetaValueStyle"><Data ss:Type="String">${escapeXml(`من: ${appliedFilters.startDate || 'البداية'} إلى: ${appliedFilters.endDate || 'الآن'}`)}</Data></Cell>
   </Row>
   <Row ss:Height="10"/>
   <Row ss:Height="25">
    <Cell ss:StyleID="HeaderStyle"><Data ss:Type="String">المؤشر المالي / التشغيلي</Data></Cell>
    <Cell ss:StyleID="HeaderStyle"><Data ss:Type="String">القيمة</Data></Cell>
   </Row>
`;

  for (const m of definition.metrics) {
    const val = metrics[m.key] ?? 0;
    xml += `   <Row>
    <Cell ss:StyleID="MetricLabelStyle"><Data ss:Type="String">${escapeXml(m.labelAr)}</Data></Cell>
    <Cell ss:StyleID="MetricValueStyle"><Data ss:Type="${m.format === 'integer' ? 'Number' : 'Number'}">${val}</Data></Cell>
   </Row>
`;
  }

  xml += `  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <DisplayRightToLeft/>
  </WorksheetOptions>
 </Worksheet>
`;

  // -------------------------------------------------------------
  // Sheet 2: سجل البيانات التفصيلي (REP-028)
  // -------------------------------------------------------------
  xml += ` <Worksheet ss:Name="سجل البيانات التفصيلي">
  <Table ss:DefaultRowHeight="20">
`;

  // تعريف أعمدة الجدول
  for (const col of exportableCols) {
    const width = col.dataType === 'money' || col.dataType === 'quantity' ? 120 : 160;
    xml += `   <Column ss:Width="${width}"/>\n`;
  }

  // صف الترويسة
  xml += `   <Row ss:Height="26">\n`;
  for (const col of exportableCols) {
    let header = col.labelAr;
    if (col.unit) header += ` (${col.unit})`;
    else if (col.dataType === 'money') header += ` (${currencySymbol})`;
    xml += `    <Cell ss:StyleID="HeaderStyle"><Data ss:Type="String">${escapeXml(header)}</Data></Cell>\n`;
  }
  xml += `   </Row>\n`;

  // صفوف البيانات
  for (const row of rows) {
    xml += `   <Row>\n`;
    for (const col of exportableCols) {
      const val = row[col.key];
      if (col.dataType === 'money' || col.dataType === 'quantity' || col.dataType === 'percentage') {
        const numVal = Number(val) || 0;
        xml += `    <Cell ss:StyleID="DataNumber"><Data ss:Type="Number">${numVal}</Data></Cell>\n`;
      } else {
        xml += `    <Cell ss:StyleID="DataText"><Data ss:Type="String">${escapeXml(val ?? '')}</Data></Cell>\n`;
      }
    }
    xml += `   </Row>\n`;
  }

  // صف الإجماليات
  const hasAggregates = exportableCols.some((c) => c.aggregate && c.aggregate !== 'none');
  if (hasAggregates && rows.length > 0) {
    xml += `   <Row ss:Height="24">\n`;
    for (let i = 0; i < exportableCols.length; i++) {
      const col = exportableCols[i];
      if (col.aggregate === 'sum') {
        const sum = rows.reduce((acc, r) => acc + (Number(r[col.key]) || 0), 0);
        xml += `    <Cell ss:StyleID="TotalRowStyle"><Data ss:Type="Number">${Number(sum.toFixed(3))}</Data></Cell>\n`;
      } else if (i === 0) {
        xml += `    <Cell ss:StyleID="TotalRowStyle"><Data ss:Type="String">الإجمالي العام</Data></Cell>\n`;
      } else {
        xml += `    <Cell ss:StyleID="TotalRowStyle"><Data ss:Type="String"></Data></Cell>\n`;
      }
    }
    xml += `   </Row>\n`;
  }

  xml += `  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <DisplayRightToLeft/>
  </WorksheetOptions>
 </Worksheet>
</Workbook>`;

  return xml;
}

export function downloadReportExcel(payload: ReportExportPayload, filename?: string): void {
  const xml = generateReportExcelXml(payload);
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const link = document.createElement('a');
  const fname = filename || `${payload.definition.id}-${new Date().toISOString().slice(0, 10)}.xls`;

  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', fname);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}
