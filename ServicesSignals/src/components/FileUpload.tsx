import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import Papa from "papaparse";
import { FileUp, Loader2 } from "lucide-react";
import * as XLSX from "xlsx";

import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

type ParsedRow = Record<string, string | number | null>;

type FileUploadProps = {
  label: string;
  description: string;
  onUpload: (rows: ParsedRow[]) => void;
  acceptedFileType?: "csv" | "excel-or-csv";
};

export function FileUpload({
  label,
  description,
  onUpload,
  acceptedFileType = "csv",
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [fileName, setFileName] = useState("");

  const parseFile = (file: File) => {
    setIsParsing(true);
    const isExcelFile = /\.(xlsx|xls)$/i.test(file.name);

    if (acceptedFileType === "excel-or-csv" && isExcelFile) {
      file
        .arrayBuffer()
        .then((buffer) => {
          const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
          const firstSheet = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheet];
          const rows = XLSX.utils.sheet_to_json<ParsedRow>(worksheet, {
            defval: "",
            raw: false,
          });
          setFileName(file.name);
          onUpload(rows);
          setIsParsing(false);
        })
        .catch(() => {
          setIsParsing(false);
        });
      return;
    }

    Papa.parse<ParsedRow>(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
      complete: (result) => {
        setFileName(file.name);
        onUpload(result.data ?? []);
        setIsParsing(false);
      },
      error: () => {
        setIsParsing(false);
      },
    });
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      parseFile(file);
    }
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      parseFile(file);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          onDrop={handleDrop}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          className={`flex min-h-36 flex-col items-center justify-center rounded-md border-2 border-dashed p-4 text-center transition-colors ${
            isDragging ? "border-primary bg-primary/5" : "border-border bg-muted/20"
          }`}
        >
          {isParsing ? <Loader2 className="mb-2 h-8 w-8 animate-spin text-muted-foreground" /> : <FileUp className="mb-2 h-8 w-8 text-muted-foreground" />}
          <p className="text-sm text-muted-foreground">{description}</p>
          {fileName && <p className="mt-2 text-xs text-foreground">Uploaded: {fileName}</p>}
          <Button className="mt-4" variant="outline" onClick={() => inputRef.current?.click()}>
            Select File
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept={acceptedFileType === "excel-or-csv" ? ".csv,.xlsx,.xls" : ".csv"}
            className="hidden"
            onChange={handleInputChange}
          />
        </div>
      </CardContent>
    </Card>
  );
}
