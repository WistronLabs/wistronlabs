import { components as SelectComponents } from "react-select";

function PartOption(props) {
  const cat = props.data.category_name;
  const dpn = props.data.dpn;

  return (
    <SelectComponents.Option {...props}>
      <div className="flex flex-col gap-1">
        <div className="text-sm font-medium text-gray-800 truncate">
          {props.data.name || props.label}
        </div>
        <div className="flex items-center justify-between gap-2">
          {dpn && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-800 font-mono">
              {dpn}
            </span>
          )}
          <span className="text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-700">
            {cat}
          </span>
        </div>
      </div>
    </SelectComponents.Option>
  );
}

export default PartOption;
