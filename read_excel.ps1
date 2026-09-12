$excelPath = "C:\Users\aayan\Downloads\SPL Auction Player Data (Responses) (2).xlsx"
$excel = New-Object -ComObject Excel.Application
$workbook = $excel.Workbooks.Open($excelPath)
$sheet = $workbook.Sheets.Item(1)
$columnCount = $sheet.UsedRange.Columns.Count
$rowCount = $sheet.UsedRange.Rows.Count

Write-Host "Total columns: $columnCount"
Write-Host "Total rows: $rowCount"
Write-Host "`nColumn Headers:"

for($i = 1; $i -le $columnCount; $i++) {
    $header = $sheet.Cells.Item(1, $i).Value2
    Write-Host "Col $i : $header"
}

Write-Host "`nFirst row data:"
for($i = 1; $i -le $columnCount; $i++) {
    $value = $sheet.Cells.Item(2, $i).Value2
    $header = $sheet.Cells.Item(1, $i).Value2
    Write-Host "$header : $value"
}

$excel.Quit()
